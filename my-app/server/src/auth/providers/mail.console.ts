/**
 * ============================================
 * 邮件 Provider —— 控制台打印（开发 / 演示）
 * ============================================
 *
 * 【用途】
 * 没有 SMTP 资质 / 本地开发时，把验证码打印到服务端控制台，
 * 让开发者能直接看到验证码完成登录/找回密码流程，不阻塞开发进度。
 *
 * 【为什么不写日志文件】
 * 验证码是敏感凭据，写入日志文件会造成持久化泄露。控制台打印是
 * 瞬态输出，配合 AUTH_OTP_DEV_PRINT 开关，仅在开发期显式开启时才打印。
 */

import type { MailProvider, OtpScene } from "./types.js";
import { SCENE_LABELS } from "./types.js";

/**
 * 控制台打印邮件 Provider。
 *
 * 【醒目标记】用分隔线包裹，便于在滚动控制台里一眼定位。
 */
export const consoleMailProvider: MailProvider = {
  async send(email: string, code: string, scene: OtpScene): Promise<void> {
    // 显式 console.log 是此 Provider 的「发送动作」，允许存在
    console.log(
      [
        "",
        "══════════════════════════════════════════════════",
        `  📧 [DEV] 模拟发送邮件验证码`,
        `  收件人  : ${email}`,
        `  场景    : ${SCENE_LABELS[scene]}`,
        `  验证码  : ${code}`,
        "  （生产环境请设置 MAIL_PROVIDER=smtp 走真实邮件）",
        "══════════════════════════════════════════════════",
      ].join("\n")
    );
  },
};
