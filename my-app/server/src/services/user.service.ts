/**
 * ============================================
 * 用户服务模块（User Service）
 * ============================================
 *
 * 【职责】
 * 封装用户资料相关的业务逻辑：
 * - 查询用户信息（不含密码）
 * - 更新用户资料（name、bio）
 * - 修改登录标识（email / phone / username，需当前密码确认）
 * - 修改密码（旧密码验证 + 新密码加密）
 * - 更新头像
 */

import bcrypt from "bcrypt";
import prisma from "../lib/prisma.js";
import { getUserRoleCodes } from "../middleware/rbac.js";
import { assertPasswordStrength } from "../lib/password.js";
import {
  normalizeAndValidateIdentifiers,
  IdentifierConflictError,
} from "../lib/identifier.js";
import { findIdentifierConflict } from "../lib/user-query.js";
import { generateToken } from "./auth.service.js";

const BCRYPT_SALT_ROUNDS = parseInt(
  process.env.BCRYPT_SALT_ROUNDS || "10",
  10
);

// ========== 返回类型定义 ==========

/** 公开的用户信息（不含密码） */
export interface UserProfile {
  id: string;
  /** 邮箱（登录标识之一，可空） */
  email: string | null;
  /** 手机号（登录标识之一，可空） */
  phone: string | null;
  /** 用户名 / 账号（登录标识之一，可空） */
  username: string | null;
  name: string | null;
  avatar: string | null;
  bio: string | null;
  /**
   * 是否已设置登录密码。
   *
   * 【为什么需要这个字段】
   * 验证码登录自动注册的账号 password 为 null（无密码），前端需要据此：
   * - 把「修改密码」表单切成「首次设置密码」形态（不要求旧密码）；
   * - 把「修改登录标识」弹窗切成引导形态（先设置密码，再改标识）。
   * 注意这里只暴露布尔值，密码哈希本身绝不外发。
   */
  hasPassword: boolean;
  /** 是否需要强制修改密码（管理员代建账号为 true） */
  mustChangePassword: boolean;
  /** 最后登录时间（审计信息，个人中心「登录与安全」展示） */
  lastLoginAt: Date | null;
  /** 最后登录 IP */
  lastLoginIp: string | null;
  /** 最后登录方式（password / email_otp / sms_otp 等） */
  lastLoginMethod: string | null;
  createdAt: Date;
}

/**
 * 用户公开字段白名单（Prisma select 片段）。
 *
 * 【为什么抽成常量】
 * 「不返回密码」这条规则在 getProfile / updateProfile / changePassword 多处生效，
 * 写成一个常量复用，比每处各抄一遍 select 更不容易漏字段、更容易审计。
 */
const PUBLIC_USER_SELECT = {
  id: true,
  email: true,
  phone: true,
  username: true,
  name: true,
  avatar: true,
  bio: true,
  mustChangePassword: true,
  lastLoginAt: true,
  lastLoginIp: true,
  lastLoginMethod: true,
  createdAt: true,
} as const;

/**
 * 在公开字段基础上额外查出密码哈希的 select。
 *
 * 【为什么单独一份】
 * PUBLIC_USER_SELECT 严格「不含密码」；但前端需要 hasPassword 布尔值，
 * 所以这里查出哈希 → 由 toPublicProfile 换算成布尔后立即丢弃，
 * 哈希本身不出现在任何接口响应里。
 */
const PROFILE_SELECT_WITH_PASSWORD = {
  ...PUBLIC_USER_SELECT,
  password: true,
} as const;

/**
 * 把「含密码哈希」的查询结果转成对外的 UserProfile。
 *
 * 唯一职责：password → hasPassword 布尔映射，映射后哈希立即丢弃。
 * 所有对外的 profile 查询/更新出口（getProfile / updateProfile /
 * updateIdentifiers）统一走这里，避免某处漏映射把哈希带出去。
 */
function toPublicProfile(
  user: { password: string | null } & Omit<UserProfile, "hasPassword">
): UserProfile {
  const { password, ...rest } = user;
  return { ...rest, hasPassword: Boolean(password) };
}

// ========== 业务函数 ==========

/**
 * 获取用户资料
 *
 * 使用 Prisma select 确保 password 字段永远不会返回给客户端。
 * 同时过滤 deletedAt：软删除的账号取不到资料。
 *
 * @param userId - 用户 ID（来自 JWT Token 的 sub 字段）
 * @returns 用户公开信息
 * @throws 用户不存在时抛出错误
 */
export async function getProfile(userId: string): Promise<UserProfile> {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    // 显式选择返回字段：密码哈希会被 toPublicProfile 换算成
    // hasPassword 布尔值后丢弃，绝不会出现在响应里
    select: PROFILE_SELECT_WITH_PASSWORD,
  });

  if (!user) {
    throw new Error("用户不存在");
  }

  return toPublicProfile(user);
}

/**
 * 更新用户资料
 *
 * 仅允许更新 name 和 bio 字段。
 * 登录标识（email / phone / username）的变更必须走 updateIdentifiers，
 * 那里会强制校验当前密码 —— 否则一旦账号被盗即可无声换绑。
 *
 * @param userId  - 用户 ID
 * @param updates - 要更新的字段（{ name?, bio? }）
 * @returns 更新后的用户信息
 */
export async function updateProfile(
  userId: string,
  updates: { name?: string; bio?: string }
): Promise<UserProfile> {
  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      // 只更新传入的字段，未传入的保持原值
      ...(updates.name !== undefined ? { name: updates.name } : {}),
      ...(updates.bio !== undefined ? { bio: updates.bio } : {}),
    },
    select: PROFILE_SELECT_WITH_PASSWORD,
  });

  return toPublicProfile(user);
}

// ============================================================
// 修改登录标识（邮箱 / 手机号 / 用户名）
// ============================================================

/** 修改登录标识的入参 */
export interface UpdateIdentifiersInput {
  /**
   * 当前密码（身份确认）。
   *
   * 【为什么必须要】
   * 在还没有「新邮箱收验证码」能力之前（无邮件/短信服务商资质），
   * 改登录标识是账号劫持的最高危操作：谁拿到别人的一次未锁屏电脑，
   * 就能把邮箱换成自己的、再走「忘记密码」永久接管账号。
   * 用「输入当前密码」做二次确认，是当前成本最低、收益最高的折中。
   * 无密码账号（验证码注册）会被步骤 2 明确拒绝，引导先设置密码。
   */
  password?: string;
  /**
   * 新的邮箱。
   * - undefined → 本次不改（保持原值）
   * - "" / null → 清空该标识
   */
  email?: string | null;
  /** 新的手机号（语义同 email） */
  phone?: string | null;
  /** 新的用户名（语义同 email） */
  username?: string | null;
}

/** 修改登录标识的返回 */
export interface UpdateIdentifiersResult {
  /** 更新后的用户资料 */
  profile: UserProfile;
  /**
   * 重新签发的 Token（仅在邮箱变更时返回）。
   *
   * 【为什么需要】
   * JWT payload 里带着 email。邮箱改了但 Token 不带更新，
   * payload 就与数据库长期不一致（虽然当前业务不依赖它，
   * 但迟早会埋雷）。重新签发一份同 tokenVersion 的 Token
   * 交给前端替换，代价极小、语义干净。
   */
  token?: string;
}

/**
 * 修改当前用户的登录标识。
 *
 * 【安全流程】
 * 1. 校验账号可用（未软删除）
 * 2. 必须提供当前密码并比对通过（无密码账号直接拒绝，引导先设置密码）
 * 3. 与库中现有值合并（未传的字段保持原值）→ 归一化 + 格式校验
 * 4. 唯一性校验（**排除自己**，否则未改动的标识会命中自己）
 * 5. 写库，三个标识整体覆盖
 *
 * 【为什么是「合并」而不是「直接覆盖入参」】
 * 入参里 undefined 表示「本次不涉及该标识」。若直接拿入参去覆盖，
 * 那么「只改邮箱」的请求会把手机号和用户名一并清成 null —— 一个
 * 极其隐蔽、且会直接导致用户丢失登录方式的 bug。因此必须先把
 * 入参与库中现值合并，再交给 normalizeAndValidateIdentifiers。
 *
 * 【「至少保留一个标识」是硬规则】
 * 由 normalizeAndValidateIdentifiers 保证：合并后三个全空直接抛错。
 * 数据库层三个字段都是可空 + 唯一，拦不住「三个全空」，
 * 必须在应用层守住，否则会产出既登不进、又找不回的孤儿账号。
 *
 * 【不吊销 Token 的理由】
 * 改标识不等于「密码泄露」，没必要把用户所有设备踢下线；
 * 唯一需要同步的是 JWT payload 里的 email，用重签（同 tokenVersion）解决。
 *
 * @param userId - 用户 ID
 * @param input  - 新标识集合 + 当前密码
 * @throws 密码不正确 / 格式非法 / 标识被占用
 */
export async function updateIdentifiers(
  userId: string,
  input: UpdateIdentifiersInput
): Promise<UpdateIdentifiersResult> {
  // ---------- 步骤 1：取当前账号（含密码哈希、现有标识、Token 版本） ----------
  const current = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: {
      password: true,
      email: true,
      phone: true,
      username: true,
      tokenVersion: true,
    },
  });

  if (!current) {
    throw new Error("用户不存在");
  }

  // ---------- 步骤 2：当前密码确认 ----------
  // 【安全修复】无密码账号（验证码登录自动注册）旧实现直接跳过确认：
  // - 前端强制要求填「当前密码」，但账号根本没有密码，用户无所适从；
  // - 更严重的是后端不做任何比对，**随便填什么密码都放行**
  //   （用户实测填 admin 的密码也能改成功）——等于改标识零身份确认。
  // 现改为明确拒绝：先在「登录与安全」设置密码，之后统一用密码确认身份。
  // 「首次设置密码」本身走 changePassword，后端对无密码账号免旧密码校验。
  if (!current.password) {
    throw new Error(
      "当前账号尚未设置密码，请先在「个人中心 → 登录与安全」设置密码，再修改登录标识"
    );
  }
  if (!input.password) {
    throw new Error("请输入当前密码以确认身份");
  }
  const passwordOk = await bcrypt.compare(input.password, current.password);
  if (!passwordOk) {
    throw new Error("当前密码不正确");
  }

  // ---------- 步骤 3：与现值合并 → 归一化 + 格式校验 + 「至少一个标识」 ----------
  const identifiers = normalizeAndValidateIdentifiers({
    email: input.email !== undefined ? input.email : current.email,
    phone: input.phone !== undefined ? input.phone : current.phone,
    username: input.username !== undefined ? input.username : current.username,
  });

  // ---------- 步骤 4：唯一性校验（排除自己） ----------
  const conflict = await findIdentifierConflict(identifiers, userId);
  if (conflict) {
    throw new IdentifierConflictError(conflict.field);
  }

  // ---------- 步骤 5：整体覆盖写库 ----------
  const profile = await prisma.user.update({
    where: { id: userId },
    data: {
      email: identifiers.email,
      phone: identifiers.phone,
      username: identifiers.username,
    },
    select: PROFILE_SELECT_WITH_PASSWORD,
  });

  const publicProfile = toPublicProfile(profile);

  // ---------- 步骤 6：邮箱变更时重签 Token，保持 payload 与库一致 ----------
  const token =
    publicProfile.email !== current.email
      ? generateToken(userId, publicProfile.email, current.tokenVersion)
      : undefined;

  return { profile: publicProfile, token };
}

/**
 * 修改密码
 *
 * 【安全流程】
 * 1. 根据用户 ID 查询当前密码密文
 * 2. 用 bcrypt.compare() 验证旧密码是否正确
 * 3. 校验新密码强度（长度下限来自系统配置 auth.password.min_length）
 * 4. 用 bcrypt.hash() 加密新密码
 * 5. 更新密码，并执行 tokenVersion++ 吊销所有旧 Token
 *
 * 【为什么要 tokenVersion++】
 * 改密码的语义是「把其他人踢下线」。若不吊销 Token，
 * 攻击者手里的旧 Token 在 7 天有效期内依然畅通无阻。
 * 加一之后，除了本次返回的新 Token，其余全部立即失效。
 *
 * 【为什么要返回新 Token】
 * 吊销是全量的，包括当前这次会话自己的旧 Token。
 * 所以必须同时签发一个新 Token 交给前端替换，否则用户改完密码就被自己踢下线。
 *
 * @param userId      - 用户 ID
 * @param oldPassword - 旧密码明文
 * @param newPassword - 新密码明文
 * @returns 新的 JWT Token（供前端替换本地存储）
 * @throws 旧密码不正确 / 新密码强度不足时抛出
 */
export async function changePassword(
  userId: string,
  oldPassword: string,
  newPassword: string
): Promise<{ token: string }> {
  // ---------- 步骤 1：查询当前密码与账号可用性 ----------
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { password: true, email: true },
  });

  if (!user) {
    throw new Error("用户不存在");
  }

  // 管理员代建 / 验证码用户可能没有密码：此时「修改密码」语义变成「首次设置密码」，
  // 不应要求填写旧密码（前端也会隐藏旧密码输入框）。
  if (user.password) {
    // ---------- 步骤 2：验证旧密码 ----------
    const isOldPasswordValid = await bcrypt.compare(oldPassword, user.password);

    if (!isOldPasswordValid) {
      throw new Error("旧密码不正确");
    }
  }

  // ---------- 步骤 3：新密码强度校验 ----------
  await assertPasswordStrength(newPassword);

  // ---------- 步骤 4：加密新密码 ----------
  const hashedNewPassword = await bcrypt.hash(
    newPassword,
    BCRYPT_SALT_ROUNDS
  );

  // ---------- 步骤 5：更新密码 + 吊销旧 Token + 清掉强制改密标记 ----------
  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      password: hashedNewPassword,
      // 主动吊销：所有旧 Token 的 tv 与新值不一致，立即 401
      tokenVersion: { increment: 1 },
      // 用户已经自己设过密码，不再需要强制改密
      mustChangePassword: false,
    },
    select: { id: true, tokenVersion: true },
  });

  // ---------- 步骤 6：签发新 Token（用新的 tokenVersion） ----------
  return { token: generateToken(updated.id, user.email, updated.tokenVersion) };
}

/**
 * 更新用户头像 URL
 *
 * 头像 URL 由文件上传端点（POST /api/user/avatar）生成。
 * 此函数仅负责将 URL 写入数据库。
 *
 * @param userId    - 用户 ID
 * @param avatarUrl - 头像的相对路径 / URL
 * @returns 更新后的头像 URL
 */
export async function updateAvatar(
  userId: string,
  avatarUrl: string
): Promise<{ avatar: string }> {
  const user = await prisma.user.update({
    where: { id: userId },
    data: { avatar: avatarUrl },
    select: { avatar: true },
  });

  return { avatar: user.avatar || "" };
}

/**
 * 获取当前用户的角色代码列表
 *
 * 【用途】
 * 前端登录后调用一次，据此判断是否管理员，
 * 动态控制「系统设置」等管理入口的显示/隐藏。
 *
 * @param userId - 用户 ID
 * @returns 角色代码数组，如 ["admin"] 或 ["user"]
 */
export async function getUserRoles(userId: string): Promise<string[]> {
  return getUserRoleCodes(userId);
}
