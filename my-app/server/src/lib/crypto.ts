/**
 * ============================================
 * 加密工具模块（Crypto Utility）
 * ============================================
 *
 * 【用途】
 * 对用户的 DeepSeek API Key 等敏感信息进行对称加密，
 * 保证密文存储、不明文入库、不明文写日志。
 *
 * 【加密算法】
 * AES-256-GCM —— 对称加密 + 认证加密（AEAD）：
 * - AES-256：256 位密钥，安全强度高
 * - GCM：认证加密模式，除了保密外还能防篡改
 *   每次加密生成随机 IV（初始化向量）和 authTag（认证标签），
 *   即使同一明文两次加密结果也不同。
 *
 * 【密文格式】
 * iv(16字节) : authTag(16字节) : ciphertext —— 均 Base64 编码后以 "." 连接
 * 三个部分缺一不可，解密时需要全部信息。
 *
 * 【密钥来源】
 * 优先读取环境变量 DEEPSEEK_ENCRYPTION_KEY，
 * 未配置时回退到 JWT_SECRET（两者都未配置时用内置兜底值）。
 * 通过 SHA-256 哈希保证密钥长度恒为 32 字节（256 位）。
 *
 * ⚠️ 生产环境务必显式配置 DEEPSEEK_ENCRYPTION_KEY，
 * 否则更换 JWT_SECRET 会导致已存密文无法解密。
 */

import crypto from "crypto";

/**
 * 获取 32 字节加密密钥
 *
 * 对任意长度的字符串密钥做 SHA-256 哈希，
 * 输出固定 32 字节，满足 AES-256 的密钥长度要求。
 */
function getEncryptionKey(): Buffer {
  const raw =
    process.env.DEEPSEEK_ENCRYPTION_KEY ||
    process.env.JWT_SECRET ||
    "careerai-default-encryption-key-change-in-production";
  return crypto.createHash("sha256").update(raw).digest();
}

/**
 * AES-256-GCM 加密
 *
 * @param plaintext - 明文（要加密的 API Key）
 * @returns 密文，格式 "iv.authTag.ciphertext"（Base64）
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  // 每次加密生成随机 IV（16 字节），保证相同明文产生不同密文
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  // GCM 认证标签，用于解密时校验完整性
  const authTag = cipher.getAuthTag();

  return [iv, authTag, encrypted].map((b) => b.toString("base64")).join(".");
}

/**
 * AES-256-GCM 解密
 *
 * @param ciphertext - encrypt() 产生的密文
 * @returns 明文
 * @throws 密文格式错误或密钥不匹配时抛出
 */
export function decrypt(ciphertext: string): string {
  const parts = ciphertext.split(".");
  if (parts.length !== 3) {
    throw new Error("密文格式错误，无法解密");
  }

  const [ivB64, tagB64, dataB64] = parts;
  const key = getEncryptionKey();
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(tagB64, "base64");
  const encrypted = Buffer.from(dataB64, "base64");

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}
