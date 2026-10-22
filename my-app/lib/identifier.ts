/**
 * ============================================
 * 登录标识识别（前端 · 与后端保持同源）
 * ============================================
 *
 * 【职责】
 * 把用户在「账号」输入框里敲的字符串实时识别为邮箱 / 手机号 / 用户名，
 * 用于切换输入框前缀图标并给出提示文案。
 *
 * ⚠️ 【单一事实源约定 —— 改这里必须同步改后端】
 * 本文件是 `my-app/server/src/lib/identifier.ts` 的前端镜像。
 * 后端那份是**权威实现**，本文件只负责即时反馈体验。
 * 两边规则一旦漂移（前端判成手机号、后端判成用户名），就会出现
 * 「提示手机号登录、实际按用户名查」的诡异登录失败，且极难排查。
 * 因此：正则常量、判定顺序、归一化方式必须逐字对齐。
 *
 * 【重要】前端**只做提示，不做判定后拆分字段**。
 * loginApi 始终把用户输入原样以 identifier 交给后端，
 * 由后端做权威判定。这样即使两边规则出现细微差异，
 * 也不会产生「前端按 A 字段查、后端按 B 字段查」的不一致。
 */

/** 三个登录标识的字段名（与后端一致） */
export type IdentifierField = "email" | "phone" | "username";

/** 邮箱格式（与后端 EMAIL_PATTERN 一致） */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 中国大陆手机号：1 开头、次位 3-9、共 11 位纯数字（与后端 PHONE_PATTERN 一致） */
export const PHONE_PATTERN = /^1[3-9]\d{9}$/;

/** 用户名：3-20 位字母/数字/下划线/中划线（与后端 USERNAME_PATTERN 一致） */
export const USERNAME_PATTERN = /^[a-zA-Z0-9_-]{3,20}$/;

/** 注册表单中用户名的提示文案（与后端校验规则一致） */
export const USERNAME_HINT =
  "3-20 位字母、数字、下划线或中划线，且不能是纯数字（纯数字会与手机号冲突）";

/** 标识字段的中文名 */
export const IDENTIFIER_LABELS: Record<IdentifierField, string> = {
  email: "邮箱",
  phone: "手机号",
  username: "用户名",
};

/** 识别结果（与后端 ResolvedIdentifier 结构一致） */
export interface ResolvedIdentifier {
  field: IdentifierField;
  value: string;
}

/**
 * 识别用户输入的账号字符串。
 *
 * 判定顺序：邮箱 → 手机号 → 用户名（与后端完全一致）。
 *
 * @param input - 用户输入的原始字符串
 * @returns 识别结果；无法识别时返回 null
 */
export function resolveIdentifier(input: string): ResolvedIdentifier | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;

  // 1. 邮箱：含 @ 即按邮箱处理
  if (raw.includes("@")) {
    const email = raw.toLowerCase();
    return EMAIL_PATTERN.test(email) ? { field: "email", value: email } : null;
  }

  // 2. 手机号：先剥离空格、中划线、括号等常见分隔符再判定
  //    （用户习惯输入 "138 0000 1111"，不剥离会误判为非法）
  const digitsOnly = raw.replace(/[\s\-()]/g, "");
  if (PHONE_PATTERN.test(digitsOnly)) {
    return { field: "phone", value: digitsOnly };
  }

  // 3. 用户名：归一化为小写（与后端写库口径一致，否则会出现大小写对不上的登录失败）
  if (USERNAME_PATTERN.test(raw) && !/^\d+$/.test(raw)) {
    return { field: "username", value: raw.toLowerCase() };
  }

  return null;
}

/**
 * 校验用户名是否合法（注册 / 新增用户表单用）。
 *
 * @param username - 待校验的用户名
 * @returns 合法返回 null，否则返回错误提示文案
 */
export function validateUsername(username: string): string | null {
  const value = (username ?? "").trim();
  if (!value) return "请输入用户名";
  if (!USERNAME_PATTERN.test(value)) {
    return `用户名格式不正确：${USERNAME_HINT}`;
  }
  if (/^\d+$/.test(value)) {
    return "用户名不能是纯数字（会与手机号登录冲突）";
  }
  return null;
}

/**
 * 校验手机号是否合法（新增用户表单用）。
 *
 * @param phone - 待校验的手机号
 * @returns 合法返回 null，否则返回错误提示文案
 */
export function validatePhone(phone: string): string | null {
  const value = (phone ?? "").trim();
  if (!value) return null; // 可选字段，空值合法
  const digitsOnly = value.replace(/[\s\-()]/g, "");
  return PHONE_PATTERN.test(digitsOnly)
    ? null
    : "手机号格式不正确（需为 11 位中国大陆手机号）";
}
