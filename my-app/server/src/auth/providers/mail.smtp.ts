/**
 * ============================================
 * 邮件 Provider —— SMTP（生产，可选）
 * ============================================
 *
 * 【用途】
 * 生产环境通过真实 SMTP 服务发送验证码邮件。
 * 使用 nodemailer，通过**动态 import** 懒加载：
 * - 未配置 SMTP 时不加载，避免给开发环境引入无谓依赖；
 * - 首次调用时才 require，未安装 nodemailer 或配置缺失时给出明确报错。
 *
 * 【环境变量】
 * SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / SMTP_FROM  必填
 * SMTP_FROM_NAME  可选（收件箱里显示的发件人名称，默认 CareerAI）
 *
 * 【邮件格式】
 * 同时发送 HTML（品牌化模板）+ 纯文本（不支持 HTML 的客户端兜底）。
 * HTML 模板遵循邮件客户端兼容性最佳实践：
 * - table 布局 + 全内联样式：Outlook 等客户端会剥离 <style> 标签，
 *   只有内联样式和 table 布局能保证在几乎所有客户端下渲染一致；
 * - 白底黑字：邮件样式与 UI 主题解耦，永远用浅色打印态；
 * - 不引用任何外部图片：避免被邮件客户端拦截或弹「显示图片」提示。
 */

import type { MailProvider, OtpScene } from "./types.js";
import { SCENE_LABELS } from "./types.js";

/**
 * 发件人显示名（收件箱列表里展示的名字）。
 * 未配置 SMTP_FROM_NAME 时默认 CareerAI；
 * 生效后可覆盖 QQ 邮箱账号自身的昵称（如「过客」）。
 */
const FROM_NAME = process.env.SMTP_FROM_NAME || "CareerAI";

/**
 * 验证码有效期（分钟）。
 * ⚠️ 需与 verification.service.ts 里 TTL_SECONDS 的口径保持一致，
 * 若那边改了 TTL，这里必须同步改，否则文案在说谎。
 */
const CODE_TTL_MINUTES = 5;

/**
 * 把业务场景翻译成「操作描述」。
 * login → 「登录」；reset_password → 「找回密码」。
 * 抽成小函数让 HTML / 纯文本两个版本共用同一口径。
 */
function actionLabel(scene: OtpScene): string {
  return scene === "reset_password" ? "找回密码" : "登录";
}

/**
 * 构建验证码邮件的 HTML 版本（品牌化模板）。
 *
 * 【结构】品牌头 → 正文 + 验证码大字 → 黄色安全提示条 → 底部声明
 *
 * 【为什么验证码用大字号 + 字间距】
 * 验证码是用户要在手机/网页间对照输入的关键信息，放大加粗 + 留白
 * 能显著降低输错率，这是主流产品（微信/GitHub/Stripe）的通用做法。
 *
 * @param code  - 明文验证码（服务端生成的 6 位数字，无注入风险）
 * @param scene - 业务场景（决定开头那句操作描述）
 */
function buildHtml(code: string, scene: OtpScene): string {
  const action = actionLabel(scene);
  return `<!doctype html>
<html lang="zh-CN">
<body style="margin:0;padding:24px;background:#f4f6f9;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;border:1px solid #e5e9f0;font-family:'PingFang SC','Microsoft YaHei',Arial,sans-serif;">
<tr><td style="padding:24px 32px;border-bottom:1px solid #eef1f5;">
<span style="font-size:20px;font-weight:700;color:#2563eb;">CareerAI</span>
<span style="font-size:13px;color:#8a94a3;margin-left:8px;">智能求职助手</span>
</td></tr>
<tr><td style="padding:32px;">
<p style="margin:0 0 16px;font-size:15px;color:#2c3340;line-height:1.7;">您好！</p>
<p style="margin:0 0 24px;font-size:15px;color:#2c3340;line-height:1.7;">您正在进行<strong>${action}</strong>操作，本次验证码为：</p>
<div style="text-align:center;margin:0 0 24px;">
<span style="display:inline-block;font-size:32px;font-weight:700;letter-spacing:8px;color:#2563eb;background:#eff6ff;border-radius:8px;padding:14px 28px;">${code}</span>
</div>
<p style="margin:0 0 8px;font-size:14px;color:#2c3340;line-height:1.7;">验证码 <strong>${CODE_TTL_MINUTES} 分钟内</strong>有效，请及时输入。</p>
<p style="margin:0 0 24px;font-size:14px;color:#2c3340;line-height:1.7;">若非本人操作，请忽略此邮件，您的账号不会受任何影响。</p>
<div style="background:#fff8eb;border:1px solid #f5e3bb;border-radius:8px;padding:12px 16px;">
<p style="margin:0;font-size:13px;color:#8a6d1f;line-height:1.6;">安全提示：验证码请勿泄露给任何人，CareerAI 官方工作人员绝不会向您索取验证码。</p>
</div>
</td></tr>
<tr><td style="padding:20px 32px;border-top:1px solid #eef1f5;">
<p style="margin:0;font-size:12px;color:#a3adbb;line-height:1.6;">本邮件由 CareerAI 系统自动发送，请勿直接回复。</p>
</td></tr>
</table>
</body>
</html>`;
}

/**
 * 构建纯文本版本（客户端不支持 HTML 时的兜底）。
 * 与 HTML 版保持同一口径：操作描述 / 有效期 / 安全提示。
 */
function buildText(code: string, scene: OtpScene): string {
  const action = actionLabel(scene);
  return [
    `您正在使用 CareerAI 账号进行${action}操作。`,
    "",
    `验证码：${code}（${CODE_TTL_MINUTES} 分钟内有效）`,
    "",
    "若非本人操作，请忽略此邮件，您的账号不会受任何影响。",
    "安全提示：验证码请勿泄露给任何人，CareerAI 官方工作人员绝不会向您索取验证码。",
  ].join("\n");
}

/** SMTP 配置缺失时抛出的错误提示 */
function missingConfig(): never {
  throw new Error(
    "SMTP 邮件通道未完整配置：请设置 SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / SMTP_FROM"
  );
}

/** SMTP 邮件 Provider */
export const smtpMailProvider: MailProvider = {
  async send(email: string, code: string, scene: OtpScene): Promise<void> {
    const host = process.env.SMTP_HOST;
    const port = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : NaN;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const from = process.env.SMTP_FROM;

    if (!host || !Number.isFinite(port) || !user || !pass || !from) {
      missingConfig();
    }

    // 动态 import：仅在真正走 SMTP 时才加载 nodemailer，避免开发环境依赖
    const nodemailer = await import("nodemailer");

    const transporter = nodemailer.default.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });

    await transporter.sendMail({
      // from 支持「名称 <地址>」格式：收件箱显示品牌名（如 CareerAI），
      // 而不是发件邮箱账号自身的昵称（如「过客」），观感更专业
      from: `${FROM_NAME} <${from}>`,
      to: email,
      subject: `CareerAI ${SCENE_LABELS[scene]}验证码`,
      text: buildText(code, scene),
      html: buildHtml(code, scene),
    });
  },
};
