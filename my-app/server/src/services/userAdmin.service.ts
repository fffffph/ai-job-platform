/**
 * ============================================
 * 用户管理服务（User Admin Service）
 * ============================================
 *
 * 【职责】
 * 面向「管理侧」的用户操作（区别于 user.service 的用户自助资料）：
 * - 用户列表（分页 + 关键字搜索 + 角色）；P1-8
 * - 新增用户（B-P0；含标识唯一性校验、密码来源、角色绑定、提权防护）
 * - 标识唯一性即时校验（供新增用户表单 blur 时提示）
 * - 分配角色（事务全量重写 UserRole）；
 * - 停用/启用账号（禁止操作自己）。
 *
 * 【错误约定】
 * 业务校验错误统一抛 MenuValidationError（复用 menu.service 的错误类，
 * 路由层 instanceof 识别 → 400/404）。
 *
 * 【软删除约定】
 * 所有「按 id 找用户」的查询都必须带 deletedAt: null。
 * 本文件统一使用 ACTIVE_USER_FILTER 展开，避免遗漏导致「删了还能被操作」。
 */

import bcrypt from "bcrypt";
import prisma from "../lib/prisma.js";
import { ROLE_CODES, getUserRoleCodes, isAdminRole } from "../middleware/rbac.js";
import { MenuValidationError } from "./menu.service.js";
import { getConfig } from "../config/config-service.js";
import {
  normalizeAndValidateIdentifiers,
  IdentifierValidationError,
  IDENTIFIER_LABELS,
  type IdentifierField,
} from "../lib/identifier.js";
import { assertPasswordStrength, PasswordPolicyError } from "../lib/password.js";
import {
  ACTIVE_USER_FILTER,
  findIdentifierConflict,
} from "../lib/user-query.js";
import type {
  AdminUserItem,
  UserStatus,
  CreateUserInput,
  CreateUserResult,
  IdentifierCheckResult,
  UpdateUserInput,
  ResetPasswordInput,
} from "../types/index.js";

/** 合法账号状态 */
const VALID_STATUS: UserStatus[] = ["active", "disabled"];

/** bcrypt 盐轮数（与 auth.service 保持一致） */
const BCRYPT_SALT_ROUNDS = parseInt(
  process.env.BCRYPT_SALT_ROUNDS || "10",
  10
);

/**
 * 用户列表（分页 + 关键字）。
 *
 * 关键字匹配 email / name / username / phone（不区分大小写）。
 * 已软删除的账号不出现在列表中。
 *
 * @param params - { keyword?, page?, pageSize? }
 * @returns { items, total, page, pageSize }
 */
export async function listUsers(params: {
  keyword?: string;
  page?: number;
  pageSize?: number;
}): Promise<{
  items: AdminUserItem[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 10));
  const keyword = params.keyword?.trim();

  // 软删除过滤 + 关键字 OR 匹配（关键字把用户名/手机号也纳入，管理员常按其一检索）
  const where = {
    ...ACTIVE_USER_FILTER,
    ...(keyword
      ? {
          OR: [
            { email: { contains: keyword, mode: "insensitive" as const } },
            { name: { contains: keyword, mode: "insensitive" as const } },
            { username: { contains: keyword, mode: "insensitive" as const } },
            { phone: { contains: keyword } },
          ],
        }
      : {}),
  };

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        email: true,
        phone: true,
        username: true,
        name: true,
        remark: true,
        status: true,
        mustChangePassword: true,
        lastLoginAt: true,
        createdAt: true,
        userRoles: {
          select: {
            role: { select: { id: true, code: true, name: true } },
          },
        },
      },
    }),
  ]);

  const items: AdminUserItem[] = users.map((u) => ({
    id: u.id,
    email: u.email,
    phone: u.phone,
    username: u.username,
    name: u.name,
    remark: u.remark,
    roles: u.userRoles.map((ur) => ur.role),
    status: (u.status === "disabled" ? "disabled" : "active") as UserStatus,
    mustChangePassword: u.mustChangePassword,
    lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
    createdAt: u.createdAt.toISOString(),
  }));

  return { items, total, page, pageSize };
}

// ============================================================
// 提权防护（新增用户 / 分配角色 共用）
// ============================================================

/**
 * 断言「操作者有权把这批角色分配给他人」。
 *
 * 【防护目标】
 * 若待分配角色中包含 admin 角色，则要求操作者本人具备 admin 角色，否则拒绝。
 * 防止被授予 `system:user:create` 或 `system:user:grant` 的非 admin 用户，
 * 通过新增用户 / 分配角色接口给自己或他人赋 admin 角色，形成权限提升。
 *
 * 【为什么要抽成公共函数】
 * 原来这段逻辑内联在 assignRoles 里。B-P0 新增的 createUser 也需要同一规则，
 * 若各写一份，将来改规则极易只改一处，留下提权后门。
 * 因此收敛到这里，两个入口共用。
 *
 * @param operatorId - 操作者用户 id（来自服务端会话 JWT，绝不信前端传参）
 * @param roleIds    - 待分配的角色 id 数组
 * @throws MenuValidationError 包含不存在的角色 / 越权分配 admin 时抛出
 */
export async function assertCanAssignRoles(
  operatorId: string,
  roleIds: string[]
): Promise<void> {
  const unique = Array.from(new Set(roleIds));
  if (unique.length === 0) return;

  // 校验角色均存在（并取出角色实体，供提权判定使用）
  const targetRoles = await prisma.role.findMany({
    where: { id: { in: unique } },
  });

  if (targetRoles.length !== unique.length) {
    throw new MenuValidationError("包含不存在的角色");
  }

  // ★ 提权防护：分配 admin 角色者必须是 admin（复用 rbac 单一事实源）
  const includesAdminRole = targetRoles.some(
    (role) => role.code === ROLE_CODES.ADMIN
  );
  if (includesAdminRole) {
    const operatorRoleCodes = await getUserRoleCodes(operatorId);
    if (!isAdminRole(operatorRoleCodes)) {
      throw new MenuValidationError("只有管理员可以分配管理员角色");
    }
  }
}

// ============================================================
// 标识唯一性即时校验
// ============================================================

/**
 * 校验某个登录标识是否已被占用（供新增/编辑用户表单 blur 时即时提示）。
 *
 * 【注意】这里不过滤 deletedAt —— 与数据库唯一索引口径保持一致，
 * 否则会出现「前端提示可用、提交时报唯一约束错误」的割裂体验。
 *
 * 【excludeUserId 的用途】
 * 编辑用户时，目标用户自己的标识天然「已存在」，若不过滤会把自己误判成
 * 冲突。编辑场景必须传目标用户 id 排除自己。
 *
 * @param field         - 标识字段（email | phone | username）
 * @param value         - 用户输入的原始值
 * @param excludeUserId - 排除的用户 id（编辑场景传目标用户自己）
 * @returns { exists, conflictField }
 */
export async function checkIdentifier(
  field: IdentifierField,
  value: string,
  excludeUserId?: string
): Promise<IdentifierCheckResult> {
  if (!IDENTIFIER_LABELS[field]) {
    throw new MenuValidationError("不支持的校验字段，仅支持 email / phone / username");
  }

  // 归一化后查（邮箱转小写、手机号去分隔符），与写库口径一致
  let normalized: string | null = null;
  try {
    normalized = normalizeAndValidateIdentifiers({ [field]: value })[field];
  } catch (error) {
    // 格式非法时不报错，前端另有格式校验；这里统一返回「未占用」
    if (error instanceof IdentifierValidationError) {
      return { exists: false };
    }
    throw error;
  }

  const conflict = await findIdentifierConflict({ [field]: normalized }, excludeUserId);
  return conflict
    ? { exists: true, conflictField: conflict.field }
    : { exists: false };
}

// ============================================================
// 新增用户（B-P0）
// ============================================================

/**
 * 管理员新增用户。
 *
 * 【业务流程】
 * 1. 校验并归一化三个登录标识（至少填一个）
 * 2. 唯一性校验（含软删除行，与数据库唯一索引口径一致）
 * 3. 提权防护（分配的角色的合法性 + 是否越权分配 admin）
 * 4. 解析密码来源（系统默认密码 / 管理员自行设置）并加密
 * 5. 事务：创建用户 + 绑定角色（任一步失败整体回滚，不产生无角色用户）
 * 6. 返回公开信息（绝不返回密码哈希）
 *
 * 【安全红线】
 * - 绝不返回 password 哈希；
 * - 使用系统默认密码时，只返回 `usedDefaultPassword: true` 作为提示，
 *   不把明文默认密码回显（前端可引导管理员去配置页查看）；
 * - 操作者身份由路由层从服务端会话取得后传入，绝不信前端传参。
 *
 * @param operatorId - 操作者用户 id（来自服务端会话）
 * @param input      - 新增用户入参
 * @returns 新用户公开信息
 */
export async function createUser(
  operatorId: string,
  input: CreateUserInput
): Promise<CreateUserResult> {
  // ---------- 步骤 1：标识校验与归一化 ----------
  let identifiers;
  try {
    identifiers = normalizeAndValidateIdentifiers({
      email: input.email,
      phone: input.phone,
      username: input.username,
    });
  } catch (error) {
    if (error instanceof IdentifierValidationError) {
      throw new MenuValidationError(error.message);
    }
    throw error;
  }

  // ---------- 步骤 2：唯一性校验 ----------
  const conflict = await findIdentifierConflict(identifiers);
  if (conflict) {
    throw new MenuValidationError(
      `${IDENTIFIER_LABELS[conflict.field]}已被占用，请换一个`
    );
  }

  // ---------- 步骤 3：角色与提权防护 ----------
  const requestedRoleIds = Array.from(new Set(input.roleIds ?? []));

  // 未指定角色时，默认绑定 user 角色（与注册流程保持一致），
  // 否则新用户登录后侧边栏为空，看起来像「没权限的坏账号」。
  let roleIds = requestedRoleIds;
  if (roleIds.length === 0) {
    const defaultRole = await prisma.role.findUnique({
      where: { code: ROLE_CODES.USER },
    });
    if (!defaultRole) {
      throw new MenuValidationError("系统缺少默认角色 user，请先执行角色种子脚本");
    }
    roleIds = [defaultRole.id];
  }

  // 提权防护：与「分配角色」共用同一个校验函数
  await assertCanAssignRoles(operatorId, roleIds);

  // ---------- 步骤 4：解析密码来源并加密 ----------
  const passwordMode = input.passwordMode === "custom" ? "custom" : "default";
  let plainPassword: string;
  const usedDefaultPassword = passwordMode === "default";

  if (passwordMode === "custom") {
    if (!input.password) {
      throw new MenuValidationError("请填写初始密码，或将密码来源改为「使用系统默认密码」");
    }
    // 自定义密码同样要过强度校验（规则与注册/改密一致）
    try {
      await assertPasswordStrength(input.password);
    } catch (error) {
      if (error instanceof PasswordPolicyError) {
        throw new MenuValidationError(error.message);
      }
      throw error;
    }
    plainPassword = input.password;
  } else {
    // 系统默认密码来自配置项 auth.user.default_password，管理员可在
    // 「系统设置 → 登录与账号」里随时修改，改完即时生效。
    const defaultPassword = await getConfig<string>("auth.user.default_password");
    if (!defaultPassword || typeof defaultPassword !== "string") {
      throw new MenuValidationError(
        "系统默认密码未配置，请到「系统设置 → 登录与账号」填写，或改用「管理员自行设置密码」"
      );
    }
    plainPassword = defaultPassword;
  }

  const hashedPassword = await bcrypt.hash(plainPassword, BCRYPT_SALT_ROUNDS);

  // ---------- 步骤 5：是否强制首次登录改密 ----------
  // 未显式传参时取配置项 auth.user.must_change_password 的默认值。
  // 用默认密码建号时，强烈建议保持开启 —— 默认密码是明文配置，
  // 只有强制改密才能让账号最终落到「只有本人知道的密码」上。
  let mustChangePassword = input.mustChangePassword;
  if (mustChangePassword === undefined) {
    try {
      mustChangePassword = await getConfig<boolean>(
        "auth.user.must_change_password"
      );
    } catch {
      mustChangePassword = true;
    }
  }

  // ---------- 步骤 6：状态校验 ----------
  const status: UserStatus = input.status ?? "active";
  if (!VALID_STATUS.includes(status)) {
    throw new MenuValidationError("账号状态不合法，仅支持 active（启用）/ disabled（停用）");
  }

  // ---------- 步骤 7：事务创建用户 + 绑定角色 ----------
  const created = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: identifiers.email,
        phone: identifiers.phone,
        username: identifiers.username,
        password: hashedPassword,
        name: input.name?.trim() || null,
        remark: input.remark?.trim() || null,
        status,
        mustChangePassword,
      },
    });

    await tx.userRole.createMany({
      data: roleIds.map((roleId) => ({ userId: user.id, roleId })),
      skipDuplicates: true,
    });

    return user;
  });

  // ---------- 步骤 8：读回角色，返回公开信息 ----------
  const createdRoles = await prisma.userRole.findMany({
    where: { userId: created.id },
    select: { role: { select: { id: true, code: true, name: true } } },
  });

  return {
    id: created.id,
    email: created.email,
    phone: created.phone,
    username: created.username,
    name: created.name,
    status: (created.status === "disabled" ? "disabled" : "active") as UserStatus,
    roles: createdRoles.map((r) => r.role),
    usedDefaultPassword,
    mustChangePassword: created.mustChangePassword,
  };
}

// ============================================================
// 分配角色
// ============================================================

/**
 * 分配角色（全量重写该用户的角色绑定）。
 *
 * 事务内先清空原绑定再写入新绑定，保证一致性。
 * 提权防护见 assertCanAssignRoles（与新增用户共用同一规则）。
 *
 * @param operatorId - 操作者用户 id（来自服务端会话，路由层 requireUser 取得）
 * @param userId     - 目标用户 id
 * @param roleIds    - 角色 id 数组（全量）
 */
export async function assignRoles(
  operatorId: string,
  userId: string,
  roleIds: string[]
): Promise<void> {
  // 只允许操作「未软删除」的账号
  const user = await prisma.user.findFirst({
    where: { id: userId, ...ACTIVE_USER_FILTER },
  });
  if (!user) {
    throw new MenuValidationError("用户不存在", 404);
  }

  const unique = Array.from(new Set(roleIds));

  // 提权防护 + 角色存在性校验（统一在公共函数里）
  await assertCanAssignRoles(operatorId, unique);

  await prisma.$transaction([
    prisma.userRole.deleteMany({ where: { userId } }),
    prisma.userRole.createMany({
      data: unique.map((roleId) => ({ userId, roleId })),
      skipDuplicates: true,
    }),
  ]);
}

/**
 * 停用 / 启用用户。
 *
 * 依据 P0-10 ④：不允许停用当前登录的自己。
 *
 * @param userId     - 目标用户 id
 * @param status     - 目标状态 active | disabled
 * @param operatorId - 当前操作人 id（用于禁止操作自己）
 */
export async function setStatus(
  userId: string,
  status: UserStatus,
  operatorId: string
): Promise<void> {
  if (!VALID_STATUS.includes(status)) {
    throw new MenuValidationError("账号状态不合法，仅支持 active（启用）/ disabled（停用）");
  }

  if (userId === operatorId) {
    throw new MenuValidationError("不能停用当前登录账号");
  }

  // 只允许操作「未软删除」的账号
  const user = await prisma.user.findFirst({
    where: { id: userId, ...ACTIVE_USER_FILTER },
  });
  if (!user) {
    throw new MenuValidationError("用户不存在", 404);
  }

  await prisma.user.update({
    where: { id: userId },
    data: { status },
  });
}

// ============================================================
// 编辑用户（B-P1）
// ============================================================

/**
 * 管理员编辑用户资料。
 *
 * 【边界说明】
 * - 不含角色（走独立「分配角色」接口）、不含状态（走独立「停用/启用」接口）；
 * - 三标识按 PATCH 语义：undefined = 保持原值，"" 或 null = 清空，
 *   但与库中现值合并后必须至少保留一个；
 * - 标识唯一性校验排除自己（否则「没改邮箱」也会命中自己报冲突）。
 *
 * @param userId - 目标用户 id
 * @param input  - 编辑入参（仅处理传入的字段）
 */
export async function updateUser(
  userId: string,
  input: UpdateUserInput
): Promise<void> {
  // ---------- 步骤 1：目标用户必须存在且未软删除 ----------
  const current = await prisma.user.findFirst({
    where: { id: userId, ...ACTIVE_USER_FILTER },
    select: { email: true, phone: true, username: true },
  });
  if (!current) {
    throw new MenuValidationError("用户不存在", 404);
  }

  // ---------- 步骤 2：三标识「与现值合并 → 归一化 + 格式校验」 ----------
  // 与个人中心 updateIdentifiers 同款合并逻辑，避免「只改昵称」时把
  // 未传的邮箱/手机号误清空。
  //
  // ★ 登录账号（用户名）一旦设置就不可修改 —— 已有值时**强制沿用库中现值**，
  //   即使调用方强行传入 username 也不生效，从服务端杜绝「改账号」的可能
  //   （前端禁用只是体验，这里才是硬边界）。
  //   例外：验证码登录自动注册的账号 username 为 null，此时允许管理员
  //   **设置一次**；写库后同样进入不可变状态。若不放开这个口子，
  //   OTP 用户的用户名将永远是 null，成为无法补全的管理死角。
  const usernameAfterMerge =
    current.username !== null ? current.username : (input.username ?? null);
  let identifiers;
  try {
    identifiers = normalizeAndValidateIdentifiers({
      email: input.email !== undefined ? input.email : current.email,
      phone: input.phone !== undefined ? input.phone : current.phone,
      username: usernameAfterMerge,
    });
  } catch (error) {
    if (error instanceof IdentifierValidationError) {
      throw new MenuValidationError(error.message);
    }
    throw error;
  }

  // ---------- 步骤 3：唯一性校验（排除自己） ----------
  const conflict = await findIdentifierConflict(identifiers, userId);
  if (conflict) {
    throw new MenuValidationError(
      `${IDENTIFIER_LABELS[conflict.field]}已被占用，请换一个`
    );
  }

  // ---------- 步骤 4：写库（三标识整体覆盖，其余字段按 PATCH 语义） ----------
  await prisma.user.update({
    where: { id: userId },
    data: {
      email: identifiers.email,
      phone: identifiers.phone,
      username: identifiers.username,
      // 昵称/备注：undefined 保持原值；空串归一为 null（清空）
      name: input.name !== undefined ? input.name?.trim() || null : undefined,
      remark:
        input.remark !== undefined ? input.remark?.trim() || null : undefined,
      // 强制改密开关：undefined 保持原值
      mustChangePassword: input.mustChangePassword,
    },
  });
}

// ============================================================
// 重置密码（B-P1）
// ============================================================

/**
 * 管理员重置某用户的密码。
 *
 * 【安全流程】
 * 1. 目标用户必须存在且未软删除
 * 2. 解析密码来源（系统默认密码 / 自定义），自定义需过强度校验
 * 3. 更新密码 + tokenVersion++（吊销该用户所有旧 Token，踢下线）+ 强制改密
 *
 * 【为什么重置后要强制改密】
 * 管理员重置的密码（尤其系统默认密码）是「他人已知」的密码，只有让用户
 * 下次登录立即改掉，账号才能落到「只有本人知道」的安全状态。
 *
 * 【为什么不返回明文】
 * 重置密码不向管理员回显明文（默认密码明文在配置页可见，自定义密码是
 * 管理员自己输入的），接口只返回成功提示。
 *
 * @param userId - 目标用户 id
 * @param input  - { passwordMode?, password? }
 */
export async function resetPassword(
  userId: string,
  input: ResetPasswordInput
): Promise<void> {
  const user = await prisma.user.findFirst({
    where: { id: userId, ...ACTIVE_USER_FILTER },
  });
  if (!user) {
    throw new MenuValidationError("用户不存在", 404);
  }

  // ---------- 解析密码来源 ----------
  const passwordMode = input.passwordMode === "custom" ? "custom" : "default";
  let plainPassword: string;

  if (passwordMode === "custom") {
    if (!input.password) {
      throw new MenuValidationError(
        "请填写新密码，或将密码来源改为「使用系统默认密码」"
      );
    }
    try {
      await assertPasswordStrength(input.password);
    } catch (error) {
      if (error instanceof PasswordPolicyError) {
        throw new MenuValidationError(error.message);
      }
      throw error;
    }
    plainPassword = input.password;
  } else {
    const defaultPassword = await getConfig<string>("auth.user.default_password");
    if (!defaultPassword || typeof defaultPassword !== "string") {
      throw new MenuValidationError(
        "系统默认密码未配置，请到「系统设置 → 登录与账号」填写，或改用「自定义新密码」"
      );
    }
    plainPassword = defaultPassword;
  }

  const hashedPassword = await bcrypt.hash(plainPassword, BCRYPT_SALT_ROUNDS);

  // ---------- 更新密码 + 踢下线 + 强制改密 ----------
  await prisma.user.update({
    where: { id: userId },
    data: {
      password: hashedPassword,
      tokenVersion: { increment: 1 },
      mustChangePassword: true,
    },
  });
}

// ============================================================
// 删除用户（B-P1，软删除）
// ============================================================

/**
 * 软删除用户（打 deletedAt 标记，不物理删除）。
 *
 * 【安全约束】
 * 1. 禁止删除当前登录的自己；
 * 2. 禁止删除最后一个 admin（否则系统将无人能进管理后台）。
 *
 * 【为什么软删除后无需额外踢下线】
 * authMiddleware / 登录 / 列表查询都带 deletedAt: null，标记后该账号
 * 的所有旧 Token 自然 401、无法再登录，无需 tokenVersion++。
 *
 * 【软删除保留唯一索引占用】
 * 与「唯一性校验不过滤 deletedAt」的现有约定一致：软删除账号仍占用
 * email/phone/username，避免出现「删了 A 再用 A 的邮箱注册」导致的
 * 数据归属混乱。回收站 / 恢复能力归属 B-P2。
 *
 * @param userId     - 目标用户 id
 * @param operatorId - 当前操作人 id（用于禁止删除自己）
 */
export async function softDeleteUser(
  userId: string,
  operatorId: string
): Promise<void> {
  if (userId === operatorId) {
    throw new MenuValidationError("不能删除当前登录账号");
  }

  const user = await prisma.user.findFirst({
    where: { id: userId, ...ACTIVE_USER_FILTER },
  });
  if (!user) {
    throw new MenuValidationError("用户不存在", 404);
  }

  // ---------- 保护最后一个 admin ----------
  const targetRoleCodes = await getUserRoleCodes(userId);
  if (isAdminRole(targetRoleCodes)) {
    // 统计当前「未软删除」的 admin 用户数（含目标本身）
    const adminCount = await prisma.userRole.count({
      where: {
        role: { code: ROLE_CODES.ADMIN },
        user: { deletedAt: null },
      },
    });
    if (adminCount <= 1) {
      throw new MenuValidationError("系统至少需要保留一个管理员，无法删除");
    }
  }

  await prisma.user.update({
    where: { id: userId },
    data: { deletedAt: new Date() },
  });
}
