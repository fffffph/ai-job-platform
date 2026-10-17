/**
 * ============================================
 * 验证码工具库（Verification Code Utils）
 * ============================================
 *
 * 【职责】
 * 验证码的「生成 + 哈希 + 常量时间比对」三件事，供
 * verification.service 与图形验证码共用。
 *
 * 【核心安全原则：明文永不落库、永不写日志】
 * - 生成 6 位数字码后，只把 `HMAC-SHA256(code, secret + target)` 的哈希存库；
 * - 校验时对用户输入的码重算哈希，再与库中哈希做常量时间比较；
 * - 这样即使数据库泄露，攻击者也拿不到可用验证码（哈希不可逆，
 *   且 HMAC 带 target 盐，同一 code 对不同 target 哈希不同）。
 *
 * 【为什么用 timingSafeEqual 而不是 ===】
 * 普通字符串比较（===）在第一个不同字符处就短路返回，比较耗时与
 * 「前几位相同」的长度正相关。攻击者可据此用计时攻击逐位猜出哈希。
 * timingSafeEqual 无论内容如何都跑满等长字节数，耗时恒定，杜绝计时侧信道。
 */

import { createHmac, randomInt, timingSafeEqual } from "crypto";

/** 验证码长度（6 位数字，符合国内验证码习惯） */
export const CODE_LENGTH = 6;

/** 验证码 HMAC 密钥（环境变量提供，缺省用兜底值仅供开发，生产必须显式配置） */
const CODE_SECRET = process.env.VERIFY_CODE_SECRET || "careerai-dev-code-secret";

/**
 * 生成 6 位数字验证码（含前导 0，如 "004237"）。
 *
 * 【为什么用 crypto.randomInt 而非 Math.random】
 * Math.random 是可预测的伪随机，用于生成安全凭据属于缺陷。
 * crypto.randomInt 是密码学安全的随机数，无法被预测。
 *
 * @returns 6 位数字字符串（"000000" ~ "999999"）
 */
export function generateCode(): string {
  const value = randomInt(0, 10 ** CODE_LENGTH);
  return value.toString().padStart(CODE_LENGTH, "0");
}

/**
 * 计算验证码的 HMAC-SHA256 哈希（十六进制）。
 *
 * 【为什么 HMAC 要带 target 盐】
 * 若只对 code 做哈希，攻击者拿到库后可用「彩虹表」批量反推常见码。
 * HMAC 的 key 用 `secret + target`，让同一 code 对不同 target 产生不同哈希，
 * 无法跨账号复用、无法预计算。
 *
 * @param code   - 明文验证码
 * @param target - 收码目标（邮箱 / 手机号），作为 HMAC 的盐
 * @returns 十六进制哈希字符串
 */
export function hashCode(code: string, target: string): string {
  return createHmac("sha256", `${CODE_SECRET}:${target}`)
    .update(code)
    .digest("hex");
}

/**
 * 常量时间比较两个字符串是否相等。
 *
 * 【为什么不能直接 ===】
 * 见文件头注释：=== 的耗时与「相同前缀长度」相关，存在计时侧信道。
 * timingSafeEqual 要求两参数字节数相同，因此长度不同时直接返回 false
 * （长度不同必然不相等，且不暴露长度信息）。
 *
 * @param a - 待比较字符串
 * @param b - 待比较字符串
 * @returns 是否完全相等
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * 校验用户输入的验证码是否与库中哈希匹配（常量时间）。
 *
 * @param code     - 用户输入的明文验证码
 * @param target   - 收码目标（与发送时一致，用于重算 HMAC）
 * @param codeHash - 库中存储的哈希
 * @returns 是否匹配
 */
export function verifyCode(
  code: string,
  target: string,
  codeHash: string
): boolean {
  return constantTimeEqual(hashCode(code, target), codeHash);
}
