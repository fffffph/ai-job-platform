/**
 * ============================================
 * 短信 Provider —— 控制台打印（开发 / 演示）
 * ============================================
 *
 * 【用途】
 * 短信通道需要企业资质审核（签名/模板），个人开发者无法申请。
 * A-P1 先以控制台打印 Mock 兜底，等资质到位再切真实短信 Provider。
 * 代码结构已就位，届时只需新增 sms.tencent.ts 并改环境变量。
 */

import type { SmsProvider, OtpScene } from "./types.js";
import { SCENE_LABELS } from "./types.js";

/** 控制台打印短信 Provider */
export const consoleSmsProvider: SmsProvider = {
  async send(phone: string, code: string, scene: OtpScene): Promise<void> {
    console.log(
      [
        "",
        "══════════════════════════════════════════════════",
        `  📱 [DEV] 模拟发送短信验证码`,
        `  收信人  : ${phone}`,
        `  场景    : ${SCENE_LABELS[scene]}`,
        `  验证码  : ${code}`,
        "  （生产环境请配置 SMS_PROVIDER=tencent 走真实短信）",
        "══════════════════════════════════════════════════",
      ].join("\n")
    );
  },
};
