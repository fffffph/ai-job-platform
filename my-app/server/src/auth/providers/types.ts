/**
 * ============================================
 * 验证码通道 Provider 类型定义
 * ============================================
 *
 * 【职责】
 * 定义「发什么」和「怎么发」的抽象接口，让业务代码与具体通道解耦。
 * 业务层只依赖 mailProvider.send(...) / smsProvider.send(...)，
 * 切换通道 = 改一个环境变量，业务逻辑零改动。
 *
 * 【为什么抽象成接口】
 * 开发期没有短信/邮件资质，用「控制台打印」Mock 兜底即可跑通完整闭环；
 * 生产环境再切到真实 SMTP / 腾讯云短信。若通道直接写在业务代码里，
 * 每次切换都要改业务逻辑，极易出 bug。
 */

/** 验证码业务场景（与数据库 VerificationCode.scene 一致） */
export type OtpScene = "login" | "reset_password";

/**
 * 邮件 Provider 接口。
 *
 * @param email - 收件邮箱地址（已归一化）
 * @param code  - 明文验证码
 * @param scene - 业务场景（用于定制邮件文案，如「登录验证码」/「找回密码验证码」）
 */
export interface MailProvider {
  send(email: string, code: string, scene: OtpScene): Promise<void>;
}

/**
 * 短信 Provider 接口。
 *
 * @param phone - 收信手机号（已归一化 11 位纯数字）
 * @param code  - 明文验证码
 * @param scene - 业务场景
 */
export interface SmsProvider {
  send(phone: string, code: string, scene: OtpScene): Promise<void>;
}

/** 场景中文名（用于 Provider 打印/文案） */
export const SCENE_LABELS: Record<OtpScene, string> = {
  login: "登录",
  reset_password: "找回密码",
};
