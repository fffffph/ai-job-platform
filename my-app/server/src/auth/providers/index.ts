/**
 * ============================================
 * 验证码通道 Provider 选择器（入口）
 * ============================================
 *
 * 【职责】
 * 根据环境变量 MAIL_PROVIDER / SMS_PROVIDER 选择对应实现，暴露
 * `mailProvider` / `smsProvider` 两个单例给业务层使用。
 *
 * 【切换方式（零业务改动）】
 * - MAIL_PROVIDER=console（默认）→ 控制台打印（开发/演示）
 * - MAIL_PROVIDER=smtp                  → 真实 SMTP 邮件（生产）
 * - SMS_PROVIDER=console（默认）→ 控制台打印
 * - SMS_PROVIDER=tencent               → 腾讯云短信（待资质到位后实现）
 *
 * 业务代码只 import { mailProvider, smsProvider }，切换通道无需改业务逻辑。
 */

import type { MailProvider, SmsProvider } from "./types.js";
import { consoleMailProvider } from "./mail.console.js";
import { consoleSmsProvider } from "./sms.console.js";
import { smtpMailProvider } from "./mail.smtp.js";

/**
 * 按环境变量选择邮件 Provider。
 *
 * 【惰性选择】在模块加载时即确定，避免每次 send 都判断；
 * 未知值时回退 console（保证开发/演示永远可跑通）。
 */
function resolveMailProvider(): MailProvider {
  const name = (process.env.MAIL_PROVIDER || "console").toLowerCase();
  if (name === "smtp") return smtpMailProvider;
  return consoleMailProvider;
}

/**
 * 按环境变量选择短信 Provider。
 *
 * 当前仅 console（腾讯云短信待企业资质到位后接入）。
 */
function resolveSmsProvider(): SmsProvider {
  const name = (process.env.SMS_PROVIDER || "console").toLowerCase();
  if (name === "tencent") {
    // 腾讯云短信尚未接入：明确抛出，避免「配置了却没生效」的隐性错误
    throw new Error(
      "腾讯云短信通道尚未接入，请保持 SMS_PROVIDER=console，或等待短信资质到位后实现 sms.tencent.ts"
    );
  }
  return consoleSmsProvider;
}

/** 邮件 Provider 单例（业务层统一入口） */
export const mailProvider: MailProvider = resolveMailProvider();

/** 短信 Provider 单例（业务层统一入口） */
export const smsProvider: SmsProvider = resolveSmsProvider();

export type { MailProvider, SmsProvider, OtpScene } from "./types.js";
