/**
 * ============================================
 * 密码策略（前端 · 与后端保持同源）
 * ============================================
 *
 * 【职责】
 * 把后端 `server/src/lib/password.ts` 的强度规则在前端镜像一份，
 * 供「注册」「新增用户」「修改密码」等表单做即时校验。
 *
 * ⚠️ 【单一事实源约定 —— 改这里必须同步改后端】
 * 后端那份是**权威实现**（最终判定权在后端），本文件只负责即时反馈。
 * 规则一旦漂移，就会出现「前端放行、后端拒绝」的提交后报错割裂体验：
 *   - 长度下限：两边都读同一个配置项 `auth.password.min_length`
 *   - 字符种类：至少包含字母 + 数字
 *   - 禁止：全为同一字符（如 aaaaaaaa）
 *
 * 【为什么最小长度用参数传入而不是在这里读配置】
 * 本文件保持纯函数（无副作用、无 window 依赖），方便在 SSR 环境 import。
 * 调用方从配置单例 `getConfigValue("auth.password.min_length", 8)` 读好后传入。
 */

/** 配置缺失时的兜底最小长度（与后端 DEFAULT_MIN_LENGTH 一致） */
export const DEFAULT_PASSWORD_MIN_LENGTH = 8;

/**
 * 校验密码强度（与后端 assertPasswordStrength 同规则）。
 *
 * @param password  - 明文密码
 * @param minLength - 最小长度（来自配置 auth.password.min_length）
 * @returns 合法返回 null；不合法返回中文错误文案（可直接用于 Form 校验）
 */
export function validatePassword(
  password: string,
  minLength: number = DEFAULT_PASSWORD_MIN_LENGTH
): string | null {
  const value = password ?? "";

  if (!value) return "请输入密码";

  if (value.length < minLength) {
    return `密码长度不能少于 ${minLength} 位`;
  }

  // 必须「字母 + 数字」同时出现，挡住 123456 / abcdefgh 这类弱密码
  if (!/[a-zA-Z]/.test(value) || !/\d/.test(value)) {
    return "密码需同时包含字母和数字";
  }

  // 全为同一字符（后端用相同正则，保持逐字对齐）
  if (/^(.)\1+$/.test(value)) {
    return "密码不能是重复的单一字符";
  }

  return null;
}

/**
 * 生成密码规则的提示文案（表单 extra 用）。
 *
 * @param minLength - 最小长度
 */
export function passwordRuleHint(minLength: number = DEFAULT_PASSWORD_MIN_LENGTH): string {
  return `至少 ${minLength} 位，且需同时包含字母和数字`;
}
