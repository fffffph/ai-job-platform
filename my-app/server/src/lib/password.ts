/**
 * ============================================
 * 密码策略模块（Password Policy）
 * ============================================
 *
 * 【职责】
 * 集中实现密码强度校验与随机密码生成，供「注册」「管理员新增用户」
 * 「修改密码」「重置密码」四处复用，避免强度规则各写一套导致漂移。
 *
 * 【为什么密码长度走系统配置】
 * 配置项 `auth.password.min_length` 在「系统设置 → 登录与账号」里可视化调整，
 * 改完即时生效，无需重新部署。强度下限由管理员按安全要求自行收紧。
 */

import { randomInt } from "crypto";
import { getConfig } from "../config/config-service.js";

/** 密码策略校验错误（路由层映射为 400） */
export class PasswordPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PasswordPolicyError";
  }
}

/** 默认最小长度（配置项缺失时的兜底） */
const DEFAULT_MIN_LENGTH = 8;

/** 随机密码长度（够长但人工可抄写） */
const GENERATED_LENGTH = 12;

/** 随机密码字符集（去掉了 0/O/1/l/I 等易混淆字符，便于口头/手抄传递） */
const LOWER = "abcdefghijkmnpqrstuvwxyz";
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGITS = "23456789";
const SYMBOLS = "!@#$%^&*";

/**
 * 读取当前生效的密码最小长度配置。
 *
 * @returns 最小长度（配置读取失败时回退 8）
 */
export async function getPasswordMinLength(): Promise<number> {
  try {
    const value = await getConfig<number>("auth.password.min_length");
    return typeof value === "number" && value >= 6 ? value : DEFAULT_MIN_LENGTH;
  } catch {
    return DEFAULT_MIN_LENGTH;
  }
}

/**
 * 校验密码强度（长度 + 字符种类）。
 *
 * 【规则】
 * 1. 长度 ≥ auth.password.min_length；
 * 2. 至少包含「字母」与「数字」两类字符（避免 123456 这类弱密码）；
 * 3. 不允许全为同一字符（如 aaaaaaaa）。
 *
 * @param password - 明文密码
 * @throws PasswordPolicyError 不满足强度要求时抛出中文提示
 */
export async function assertPasswordStrength(password: string): Promise<void> {
  const minLength = await getPasswordMinLength();

  if (!password || password.length < minLength) {
    throw new PasswordPolicyError(`密码长度不能少于 ${minLength} 位`);
  }

  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
    throw new PasswordPolicyError("密码需同时包含字母和数字");
  }

  if (/^(.)\1+$/.test(password)) {
    throw new PasswordPolicyError("密码不能是重复的单一字符");
  }
}

/**
 * 生成一个满足强度要求的随机密码。
 *
 * 【实现要点】
 * 用 crypto.randomInt 而非 Math.random —— 后者是可预测的伪随机，
 * 用于生成凭据属于安全缺陷。
 * 先生成四类字符各一个保证种类齐全，再补足长度，最后洗牌打散顺序。
 *
 * @returns 12 位随机密码
 */
export function generateRandomPassword(): string {
  const pools = [LOWER, UPPER, DIGITS, SYMBOLS];
  const chars: string[] = pools.map((pool) => pool[randomInt(pool.length)]);

  const all = LOWER + UPPER + DIGITS + SYMBOLS;
  while (chars.length < GENERATED_LENGTH) {
    chars.push(all[randomInt(all.length)]);
  }

  // Fisher–Yates 洗牌：避免「前四位必然是"小写+大写+数字+符号"」的可预测结构
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join("");
}
