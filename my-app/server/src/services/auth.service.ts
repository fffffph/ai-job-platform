/**
 * ============================================
 * 认证服务模块（Auth Service）
 * ============================================
 *
 * 【职责】
 * 封装所有与用户认证相关的业务逻辑，包括：
 * - 用户注册（邮箱校验、密码加密、数据入库）
 * - 用户登录（邮箱查找、密码比对、Token 生成）
 *
 * 【安全设计原则】
 * 1. 密码永不存储明文：注册时通过 bcrypt.hash() 生成密文
 * 2. 登录时不返回密码字段：查询时使用 Prisma select 排除 password
 * 3. Token 包含过期时间：防止 token 被长期滥用
 * 4. 错误信息不区分"用户不存在"和"密码错误"（防止用户名枚举攻击）
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
 */

import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import prisma from "../lib/prisma.js";
import type {
  RegisterRequest,
  LoginRequest,
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

// ============================================================
// 注册服务
// ============================================================

/**
 * 用户注册
 *
 * 【业务流程】
 * 1. 检查邮箱是否已注册（唯一性校验）
 * 2. 使用 bcrypt.hash() 对密码进行加盐哈希
 * 3. 将用户信息存入数据库
 * 4. 生成 JWT Token 并返回
 *
 * @param data - 注册表单数据（email, password, name?）
 * @returns 包含 token 和用户信息的认证响应
 * @throws 邮箱已注册时抛出错误
 */
export async function register(
  data: RegisterRequest
): Promise<AuthResponseData> {
  // ---------- 步骤 1：检查邮箱唯一性 ----------
  const existingUser = await prisma.user.findUnique({
    where: { email: data.email },
  });

  // 如果邮箱已存在，拒绝注册
  if (existingUser) {
    throw new Error("该邮箱已被注册，请使用其他邮箱或直接登录");
  }

  // ---------- 步骤 2：密码加密 ----------
  // bcrypt.hash(明文, 盐轮数) 返回带有盐值的哈希字符串
  // 盐值自动生成并包含在结果中，后续验证时自动提取
  const hashedPassword = await bcrypt.hash(
    data.password,
    BCRYPT_SALT_ROUNDS
  );

  // ---------- 步骤 3：创建用户 ----------
  const user = await prisma.user.create({
    data: {
      email: data.email,
      // ⚠️ 存入数据库的是 bcrypt 哈希值，不是原始密码！
      password: hashedPassword,
      name: data.name || null,
    },
  });

  // ---------- 步骤 4：生成 JWT Token ----------
  const token = generateToken(user.id, user.email);

  // 返回认证数据（不包含密码）
  return {
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt,
    },
  };
}

// ============================================================
// 登录服务
// ============================================================

/**
 * 用户登录
 *
 * 【业务流程】
 * 1. 根据邮箱查找用户
 * 2. 使用 bcrypt.compare() 比对密码
 * 3. 生成 JWT Token 并返回
 *
 * 【安全提示】
 * 错误信息统一返回"邮箱或密码错误"，不区分具体原因。
 * 这样做是为了防止用户名枚举攻击：
 * 如果返回"用户不存在"，攻击者可以用不同邮箱试探，找出已注册的账号。
 *
 * @param data - 登录表单数据（email, password）
 * @returns 包含 token 和用户信息的认证响应
 * @throws 邮箱或密码错误时抛出
 */
export async function login(
  data: LoginRequest
): Promise<AuthResponseData> {
  // ---------- 步骤 1：查找用户 ----------
  const user = await prisma.user.findUnique({
    where: { email: data.email },
  });

  // 用户不存在：统一抛出模糊错误信息
  if (!user) {
    throw new Error("邮箱或密码错误");
  }

  // ---------- 步骤 2：密码比对 ----------
  // bcrypt.compare(明文, 密文) 返回 boolean
  // 内部流程：从密文中提取盐值 → 用相同盐值对明文加密 → 比对结果
  const isPasswordValid = await bcrypt.compare(
    data.password,
    user.password
  );

  // 密码不匹配：统一抛出模糊错误信息
  if (!isPasswordValid) {
    throw new Error("邮箱或密码错误");
  }

  // ---------- 步骤 3：生成 JWT Token ----------
  const token = generateToken(user.id, user.email);

  // 返回认证数据（不包含密码）
  return {
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt,
    },
  };
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
 * - Payload: 用户数据（id, email）+ 过期时间（exp）
 * - Signature: 用 JWT_SECRET 签名，防止篡改
 *
 * 【Token 使用方式】
 * 前端收到 token 后存储在 localStorage 或 cookie 中，
 * 后续请求在 Authorization header 中携带：
 * Authorization: Bearer <token>
 *
 * @param userId - 用户数据库 ID（UUID）
 * @param email  - 用户邮箱
 * @returns JWT 签名字符串
 */
function generateToken(userId: string, email: string): string {
  // 从环境变量解析过期时间（支持 "7d"、3600 等格式）
  // jwt.sign 的 expiresIn 可接受 number（秒）或 StringValue（如 "7d"）
  const rawExpiresIn = process.env.JWT_EXPIRES_IN || "7d";

  return jwt.sign(
    {
      sub: userId,
      email,
    },
    JWT_SECRET,
    {
      expiresIn: rawExpiresIn as jwt.SignOptions["expiresIn"],
      issuer: "careerai-api",
    }
  );
}
