/**
 * ============================================
 * 认证服务模块（Auth Service）
 * ============================================
 *
 * 【职责】
 * 封装所有与用户认证相关的业务逻辑，包括：
 * - 用户注册（标识校验、密码加密、数据入库、绑定默认角色）
 * - 用户登录（统一标识识别、密码比对、Token 生成、审计回写）
 *
 * 【安全设计原则】
 * 1. 密码永不存储明文：注册时通过 bcrypt.hash() 生成密文
 * 2. 登录时不返回密码字段：查询时用 select 白名单排除 password
 * 3. Token 包含过期时间与 tokenVersion：前者防长期滥用，后者支持主动吊销
 * 4. 错误信息不区分"用户不存在"和"密码错误"（防止用户名枚举攻击）
 * 5. 软删除账号不可登录：所有登录查询都带 deletedAt: null（由 user-query 封装保证）
 *
 * 【bcrypt 加密原理解析】
 * bcrypt 是一种基于 Blowfish 加密算法的密码哈希函数。
 * 关键特性：
 * - 盐（Salt）：自动生成随机盐值，每次加密结果不同
 * - 盐轮数（Salt Rounds）：默认 10，数值越大越安全但加密越慢
 * - 不可逆：无法从哈希值反推出原始密码
 *
 * 加密流程图：
 *   明文 "123456"
 *     → bcrypt.hash(明文, 10)
 *       → $2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy
 *          ↑  ↑   ↑
 *          │  │   盐（22 位） + 哈希值
 *          │  盐轮数 = 10
 *          bcrypt 版本 2b
 *
 * 【统一登录入口（A-P0 新增）】
 * 登录不再只认邮箱：identifier 传进来后由 resolveIdentifier 判定
 * 是邮箱 / 手机号 / 用户名，再用该单一字段精确查库。
 * 绝不用 OR 模糊匹配三个字段——否则「A 的用户名 == B 的手机号」时会查出
 * 两个人，无法确定给谁比对密码，属于越权隐患。
 */

import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import prisma from "../lib/prisma.js";
import { ROLE_CODES } from "../middleware/rbac.js";
import {
  resolveIdentifier,
  normalizeAndValidateIdentifiers,
  IdentifierValidationError,
  type ResolvedIdentifier,
} from "../lib/identifier.js";
import {
  findActiveUserByIdentifier,
  findIdentifierConflict,
  touchLoginAudit,
} from "../lib/user-query.js";
import { verifyAndConsume } from "./verification.service.js";
import { getConfig } from "../config/config-service.js";
import { assertPasswordStrength } from "../lib/password.js";
import type {
  RegisterRequest,
  LoginRequest,
  LoginByCodeRequest,
  ResetPasswordRequest,
  AuthResponseData,
} from "../types/index.js";

// ============================================================
// 常量配置
// ============================================================

/** bcrypt 盐轮数，从环境变量读取，默认 10 */
const BCRYPT_SALT_ROUNDS = parseInt(
  process.env.BCRYPT_SALT_ROUNDS || "10",
  10
);

/** JWT 签名密钥 */
const JWT_SECRET = process.env.JWT_SECRET || "fallback-secret";

/** 登录方式标识（写入 User.lastLoginMethod 与日志，便于后续做风控分析） */
export const LOGIN_METHOD = {
  /** 账号密码登录 */
  PASSWORD: "password",
  /** 邮箱验证码登录（P1 实现） */
  EMAIL_OTP: "email_otp",
  /** 手机短信验证码登录（P1 实现） */
  SMS_OTP: "sms_otp",
  /** 第三方 OAuth 登录（P2 实现） */
  OAUTH: "oauth",
} as const;

export type LoginMethod = (typeof LOGIN_METHOD)[keyof typeof LOGIN_METHOD];

// ============================================================
// 注册服务
// ============================================================

/**
 * 用户注册
 *
 * 【业务流程】
 * 1. 校验并归一化登录标识（邮箱 / 用户名均可选，但至少一个非空）
 * 2. 检查标识是否已被占用（与数据库唯一索引口径一致，含软删除行）
 * 3. 使用 bcrypt.hash() 对密码进行加盐哈希
 * 4. 事务内创建用户 + 绑定默认 user 角色
 * 5. 生成 JWT Token 并返回
 *
 * @param data - 注册表单数据（email?, password, username?, name?）
 * @returns 包含 token 和用户信息的认证响应
 * @throws 标识格式非法 / 已被占用时抛出错误
 */
export async function register(
  data: RegisterRequest
): Promise<AuthResponseData> {
  // ---------- 步骤 1：校验并归一化登录标识 ----------
  // 邮箱已改为可选：三标识体系下仅用户名也能注册登录；
  // 归一化会顺手把邮箱/用户名转小写、手机号去分隔符，
  // 并强制「至少一个标识非空」（否则账号无法登录，直接抛错）。
  const identifiers = normalizeAndValidateIdentifiers({
    email: data.email,
    username: data.username,
  });

  // ---------- 步骤 2：唯一性校验 ----------
  // 注意：这里不过滤 deletedAt —— 数据库唯一索引覆盖全部行，
  // 若只在应用层过滤软删除行，写库时仍会被唯一约束拦下并抛 500。
  const conflict = await findIdentifierConflict(identifiers);
  if (conflict) {
    throw new Error(
      conflict.field === "email"
        ? "该邮箱已被注册，请使用其他邮箱或直接登录"
        : conflict.field === "username"
          ? "该用户名已被占用，请换一个"
          : "该手机号已被占用，请换一个"
    );
  }

  // ---------- 步骤 3：密码加密 ----------
  // bcrypt.hash(明文, 盐轮数) 返回带有盐值的哈希字符串
  // 盐值自动生成并包含在结果中，后续验证时自动提取
  const hashedPassword = await bcrypt.hash(
    data.password,
    BCRYPT_SALT_ROUNDS
  );

  // ---------- 步骤 4：创建用户并绑定默认角色 ----------
  // 依据决策 D5：新注册用户自动绑定 user 角色，否则登录后侧边栏为空。
  // 用事务保证「创建用户 + 绑定角色」原子性：任一步失败则整体回滚，不产生无角色用户。
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email: identifiers.email,
        // 用户名作为真正的登录账号写入 username 字段（历史版本误写入 name）
        username: identifiers.username,
        // ⚠️ 存入数据库的是 bcrypt 哈希值，不是原始密码！
        password: hashedPassword,
        name: data.name || null,
      },
    });

    // 查找默认 user 角色（由 seed-roles 预置）；存在才绑定，避免因缺种子导致注册失败
    const defaultRole = await tx.role.findUnique({ where: { code: ROLE_CODES.USER } });
    if (defaultRole) {
      await tx.userRole.create({
        data: { userId: created.id, roleId: defaultRole.id },
      });
    }

    return created;
  });

  // ---------- 步骤 5：生成 JWT Token ----------
  const token = generateToken(user.id, user.email, user.tokenVersion);

  // 返回认证数据（不包含密码）
  return {
    token,
    user: toPublicUser(user),
  };
}

// ============================================================
// 登录服务
// ============================================================

/**
 * 用户登录（统一入口：邮箱 / 手机号 / 用户名 + 密码）
 *
 * 【业务流程】
 * 1. 从 identifier（或兼容字段 email）解析出标识类型
 * 2. 按该单一标识字段查「活跃」用户（排除软删除）
 * 3. 使用 bcrypt.compare() 比对密码
 * 4. 校验账号状态与是否已设置密码
 * 5. 生成 JWT Token（含 tokenVersion）并回写登录审计
 *
 * 【安全提示】
 * 错误信息统一返回"账号或密码错误"，不区分具体原因。
 * 这样做是为了防止用户名枚举攻击：
 * 如果返回"用户不存在"，攻击者可以用不同账号试探，找出已注册的账号。
 *
 * @param data - 登录表单数据（identifier 或 email, password）
 * @param meta - 可选，客户端信息（IP），用于登录审计
 * @returns 包含 token 和用户信息的认证响应
 * @throws 标识格式非法 / 账号或密码错误 / 账号停用 / 未设置密码
 */
export async function login(
  data: LoginRequest,
  meta: { ip?: string | null } = {}
): Promise<AuthResponseData> {
  // ---------- 步骤 1：统一标识解析 ----------
  // identifier 优先；缺省时回退到旧的 email 字段（向后兼容旧前端，平滑升级）
  const rawInput = data.identifier ?? data.email ?? "";

  const resolved: ResolvedIdentifier | null = resolveIdentifier(rawInput);
  if (!resolved) {
    throw new IdentifierValidationError(
      "账号格式不正确，请输入邮箱、手机号或用户名"
    );
  }

  // ---------- 步骤 2：按单一标识查活跃用户 ----------
  const user = await findActiveUserByIdentifier(resolved.field, resolved.value);

  // 用户不存在（或已软删除）：统一抛出模糊错误信息
  if (!user) {
    throw new Error("账号或密码错误");
  }

  // ---------- 步骤 3：密码是否存在与比对 ----------
  // 验证码登录 / OAuth 用户 / 管理员「不设密码」创建的账号没有密码。
  // 这里给出明确文案（而不是笼统的"密码错误"），否则用户会反复试密码。
  if (!user.password) {
    throw new Error("该账号未设置密码，请联系管理员或用验证码登录");
  }

  // bcrypt.compare(明文, 密文) 返回 boolean
  // 内部流程：从密文中提取盐值 → 用相同盐值对明文加密 → 比对结果
  const isPasswordValid = await bcrypt.compare(data.password, user.password);

  // 密码不匹配：统一抛出模糊错误信息
  if (!isPasswordValid) {
    throw new Error("账号或密码错误");
  }

  // ---------- 步骤 4：账号停用拦截（P0-11） ----------
  // 依据决策 D6：停用用户即使密码正确也拒绝登录，给出明确文案
  // （与"账号或密码错误"区分，便于前端提示"请联系管理员"）。
  if (user.status === "disabled") {
    throw new Error("账号已被停用，请联系管理员");
  }

  // ---------- 步骤 5：生成 JWT Token（含 tokenVersion） ----------
  const token = generateToken(user.id, user.email, user.tokenVersion);

  // ---------- 步骤 6：回写登录审计（失败不影响登录） ----------
  // 审计信息属于「锦上添花」，写库异常不应让用户登录失败，故 catch 兜底。
  void touchLoginAudit(user.id, {
    lastLoginAt: new Date(),
    lastLoginIp: meta.ip ?? null,
    lastLoginMethod: LOGIN_METHOD.PASSWORD,
  }).catch(() => undefined);

  // 返回认证数据（不包含密码）
  return {
    token,
    user: toPublicUser(user),
  };
}

// ============================================================
// 验证码登录服务（A-P1）
// ============================================================

/**
 * 邮箱 / 手机号验证码登录（免密）。
 *
 * 【业务流程】
 * 1. 校验并一次性消费验证码（verifyAndConsume，含过期/失败次数/重放防护）；
 * 2. 解析标识（只支持 email / phone，username 无收码通道）；
 * 3. 查活跃用户：存在 → 校验状态后签发 JWT；
 *    不存在 → 依据 auth.login.otp_auto_register 决定自动注册或拒绝；
 * 4. 回写登录审计（method=email_otp / sms_otp）。
 *
 * 【自动注册】
 * 未注册的邮箱/手机号做验证码登录，若开关开启则直接建号（无密码）并登录。
 * 这类账号密码为空，之后只能用验证码登录，除非用户主动去个人中心设密码。
 *
 * @param data - { identifier, code }
 * @param meta - 客户端 IP（审计 + 自动注册创建账号）
 * @returns 认证响应
 */
export async function loginByCode(
  data: LoginByCodeRequest,
  meta: { ip?: string | null } = {}
): Promise<AuthResponseData> {
  // ---------- 步骤 1：识别标识（只支持邮箱 / 手机号） ----------
  const resolved = resolveIdentifier(data.identifier);
  if (!resolved) {
    throw new IdentifierValidationError(
      "请输入正确的邮箱或手机号"
    );
  }
  if (resolved.field === "username") {
    throw new IdentifierValidationError(
      "用户名无法使用验证码登录，请改用邮箱或手机号"
    );
  }

  // ---------- 步骤 2：校验并消费验证码 ----------
  // 校验通过即标记 consumed；后续任何失败都不会导致验证码被「退回」，
  // 用户需重新获取，符合一次性验证码的预期。
  await verifyAndConsume(resolved.value, "login", data.code);

  // ---------- 步骤 3：查活跃用户 ----------
  let user = await findActiveUserByIdentifier(resolved.field, resolved.value);

  // ---------- 步骤 4：未注册 → 自动注册或拒绝 ----------
  if (!user) {
    const autoRegister = await getConfig<boolean>(
      "auth.login.otp_auto_register"
    );
    if (!autoRegister) {
      // 不泄露「该账号是否存在」的精准信息，统一返回通用文案
      throw new Error("该账号未注册，请先注册或联系管理员");
    }

    // 自动注册：创建无密码账号 + 绑定默认 user 角色
    user = await createOtpUser(resolved.field, resolved.value);
  }

  // ---------- 步骤 5：账号停用拦截 ----------
  if (user.status === "disabled") {
    throw new Error("账号已被停用，请联系管理员");
  }

  // ---------- 步骤 6：签发 JWT + 审计 ----------
  const token = generateToken(user.id, user.email, user.tokenVersion);
  const method =
    resolved.field === "email" ? LOGIN_METHOD.EMAIL_OTP : LOGIN_METHOD.SMS_OTP;

  void touchLoginAudit(user.id, {
    lastLoginAt: new Date(),
    lastLoginIp: meta.ip ?? null,
    lastLoginMethod: method,
  }).catch(() => undefined);

  return { token, user: toPublicUser(user) };
}

/**
 * 为「验证码登录自动注册」创建无密码账号。
 *
 * 【为什么抽成独立函数】
 * 自动注册与「密码注册 register」的差异在于：不设密码、不校验密码强度，
 * 但同样要绑定默认 user 角色、保证账号有登录标识。逻辑内聚便于维护。
 *
 * @param field - 标识字段（email / phone）
 * @param value - 归一化后的标识值
 * @returns 新建用户（含 tokenVersion 等公开字段）
 */
async function createOtpUser(
  field: "email" | "phone",
  value: string
): Promise<NonNullable<Awaited<ReturnType<typeof findActiveUserByIdentifier>>>> {
  // 建号前做唯一性校验（含软删除行，与数据库唯一索引口径一致）。
  // 理论上刚查过 findActiveUserByIdentifier 返回 null，但那只过滤了
  // 软删除行——若存在软删除的旧账号占用该标识，这里应拒绝自动注册，
  // 避免「软删账号的邮箱又被别人注册」的归属混乱。
  const conflict = await findIdentifierConflict(
    field === "email" ? { email: value } : { phone: value }
  );
  if (conflict) {
    throw new Error("该账号标识已被占用，请联系管理员");
  }

  const created = await prisma.$transaction(async (tx) => {
    const newUser = await tx.user.create({
      data: {
        email: field === "email" ? value : null,
        phone: field === "phone" ? value : null,
        // 无密码账号：password 保持 null，仅能用验证码登录
        username: null,
        name: null,
      },
    });

    const defaultRole = await tx.role.findUnique({
      where: { code: ROLE_CODES.USER },
    });
    if (defaultRole) {
      await tx.userRole.create({
        data: { userId: newUser.id, roleId: defaultRole.id },
      });
    }
    return newUser;
  });

  // 读回完整公开字段（含 tokenVersion / mustChangePassword 等）
  return (await findActiveUserByIdentifier(field, value))!;
}

// ============================================================
// 忘记密码服务（A-P1）
// ============================================================

/**
 * 忘记密码：验证码校验通过后重置密码。
 *
 * 【业务流程】
 * 1. 识别标识（邮箱 / 手机号）；
 * 2. 校验并消费验证码（scene=reset_password，与登录验证码隔离，不可混用）；
 * 3. 校验新密码强度；
 * 4. 更新密码哈希 + tokenVersion++（吊销所有旧 Token，强制重新登录）。
 *
 * 【为什么 reset_password 与 login 场景隔离】
 * 登录验证码和找回密码验证码语义不同、发送文案不同、复用会埋下
 * 「拿登录验证码去重置他人密码」的隐患。scene 隔离从源头杜绝。
 *
 * @param data - { identifier, code, newPassword }
 */
export async function resetPassword(
  data: ResetPasswordRequest
): Promise<void> {
  // ---------- 步骤 1：识别标识 ----------
  const resolved = resolveIdentifier(data.identifier);
  if (!resolved || resolved.field === "username") {
    throw new IdentifierValidationError("请输入正确的邮箱或手机号");
  }

  // ---------- 步骤 2：校验并消费找回密码验证码 ----------
  await verifyAndConsume(resolved.value, "reset_password", data.code);

  // ---------- 步骤 3：校验新密码强度 ----------
  await assertPasswordStrength(data.newPassword);

  // ---------- 步骤 4：查活跃用户 ----------
  const user = await findActiveUserByIdentifier(resolved.field, resolved.value);
  if (!user) {
    // 验证码已消费，但账号不存在（理论上不可能，发送验证码时会校验）——
    // 统一返回模糊错误，不泄露账号存在性。
    throw new Error("账号不存在或已被禁用");
  }
  if (user.status === "disabled") {
    throw new Error("账号已被停用，请联系管理员");
  }

  // ---------- 步骤 5：加密新密码 + tokenVersion++ 踢下线 ----------
  const hashedPassword = await bcrypt.hash(data.newPassword, BCRYPT_SALT_ROUNDS);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      password: hashedPassword,
      tokenVersion: { increment: 1 },
      // 找回密码后不再强制改密（用户刚设了新密码）
      mustChangePassword: false,
    },
  });
}

// ============================================================
// 工具函数
// ============================================================

/**
 * 生成 JWT Token
 *
 * 【JWT 结构】
 * JWT 由三部分组成（用 . 分隔）：
 * Header.Payload.Signature
 * - Header: 算法类型（HS256）
 * - Payload: 用户数据（sub, email, tv）+ 过期时间（exp）
 * - Signature: 用 JWT_SECRET 签名，防止篡改
 *
 * 【tv（tokenVersion）的作用】
 * 把用户当前的 tokenVersion 写进载荷。authMiddleware 每个请求都会
 * 把它和数据库里的当前值比对，一旦不一致（说明该用户改过密码 /
 * 被管理员重置 / 被强制下线）就直接 401，实现「JWT 主动吊销」。
 *
 * 【Token 使用方式】
 * 前端收到 token 后存储在 localStorage 或 cookie 中，
 * 后续请求在 Authorization header 中携带：
 * Authorization: Bearer <token>
 *
 * @param userId       - 用户数据库 ID（UUID）
 * @param email        - 用户邮箱（可能为 null，仅用于便于排查问题）
 * @param tokenVersion - 用户当前的 Token 版本号
 * @returns JWT 签名字符串
 */
export function generateToken(
  userId: string,
  email: string | null,
  tokenVersion: number
): string {
  // 从环境变量解析过期时间（支持 "7d"、3600 等格式）
  // jwt.sign 的 expiresIn 可接受 number（秒）或 StringValue（如 "7d"）
  const rawExpiresIn = process.env.JWT_EXPIRES_IN || "7d";

  return jwt.sign(
    {
      sub: userId,
      email: email ?? "",
      /** Token 版本号，用于主动吊销 */
      tv: tokenVersion,
    },
    JWT_SECRET,
    {
      expiresIn: rawExpiresIn as jwt.SignOptions["expiresIn"],
      issuer: "careerai-api",
    }
  );
}

/**
 * 把数据库用户行裁剪为「可对外返回」的公开结构。
 *
 * 【为什么单独抽一个函数】
 * 返回值里绝不能出现 password / deepseekKeyCipher 等敏感字段。
 * 集中在这里裁剪，比在每个 service 里各写一遍 select 更难漏。
 *
 * @param user - 用户行（需含公开字段）
 * @returns 公开用户信息
 */
function toPublicUser(user: {
  id: string;
  email: string | null;
  phone: string | null;
  username: string | null;
  name: string | null;
  avatar: string | null;
  bio: string | null;
  mustChangePassword: boolean;
  createdAt: Date;
}): AuthResponseData["user"] {
  return {
    id: user.id,
    email: user.email,
    phone: user.phone,
    username: user.username,
    name: user.name,
    avatar: user.avatar,
    bio: user.bio,
    mustChangePassword: user.mustChangePassword,
    createdAt: user.createdAt,
  };
}
