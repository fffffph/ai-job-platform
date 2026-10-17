/**
 * ============================================
 * 验证码服务（Verification Service）
 * ============================================
 *
 * 【职责】
 * 验证码发送与校验的核心业务逻辑，包括：
 * - sendCode：标识归一化 → 频控 → 图形验证码判断 → 生成码 → 存哈希 → Provider 下发
 * - verifyAndConsume：取最近未消费的码 → 过期/失败次数校验 → 常量时间比对 → 一次性消费
 *
 * 【安全设计（每一条都是防「短信/邮件轰炸」的必需品）】
 * 1. 明文永不落库：只存 HMAC-SHA256 哈希（lib/verification-code.ts）；
 * 2. 重发冷却：同 target 60 秒内不可重发（前端倒计时 + 后端独立校验，不信前端）；
 * 3. 频次上限：同 target 1 小时 5 条、1 天 10 条；同 IP 1 天 20 条；
 * 4. 图形验证码：同 IP 当日第 3 次请求起强制（auth.captcha.required 控制）；
 * 5. 失败上限：累计校验失败 5 次即作废该码；
 * 6. 一次性消费：校验成功立即写 consumed_at，同一码不可复用（防重放）；
 * 7. 常量时间比对：timingSafeEqual，防计时侧信道。
 *
 * 【错误约定】
 * 业务校验错误统一抛 OtpError（带 code + status），路由层 instanceof 识别后
 * 映射为对应 HTTP 状态码与错误码，前端据此做精准提示。
 */

import prisma from "../lib/prisma.js";
import {
  generateCode,
  hashCode,
  verifyCode,
} from "../lib/verification-code.js";
import {
  generateCaptcha,
  verifyCaptcha,
} from "../lib/captcha.js";
import {
  mailProvider,
  smsProvider,
  type OtpScene,
} from "../auth/providers/index.js";
import { getConfig } from "../config/config-service.js";
import { resolveIdentifier } from "../lib/identifier.js";

// ============================================================
// 错误类型
// ============================================================

/**
 * 验证码业务错误（带错误码 + 状态码）。
 *
 * 路由层通过 instanceof 识别，返回 code 与 status。
 */
export class OtpError extends Error {
  /** 错误码（前端据此做精准提示） */
  public readonly code: string;
  /** HTTP 状态码（默认 400） */
  public readonly status: number;

  constructor(message: string, code: string, status: number = 400) {
    super(message);
    this.name = "OtpError";
    this.code = code;
    this.status = status;
  }
}

// ============================================================
// 频控常量（硬编码的「分钟级/小时级」限流，与配置项解耦）
// ============================================================

/** 单标识 1 小时发送上限 */
const HOURLY_LIMIT = 5;

/** 单 IP 1 天发送上限 */
const IP_DAILY_LIMIT = 20;

/** 同 IP 当日第几次发送起强制图形验证码 */
const CAPTCHA_FORCE_THRESHOLD = 3;

/** 累计校验失败多少次后作废该验证码 */
const MAX_ATTEMPTS = 5;

/** 验证码校验失败的兜底错误码（统一返回，不泄露具体是"过期"还是"没发过"） */
const CODE_INVALID = "OTP_INVALID";

// ============================================================
// 发送验证码
// ============================================================

/**
 * 发送验证码。
 *
 * 【标识范围】
 * 只支持 email / phone（username 没有收码通道，无法接收验证码）。
 * resolveIdentifier 判定后，若结果是 username 或非法，直接拒绝。
 *
 * @param params - { identifier, scene, captchaId?, captchaText?, ip? }
 * @returns { expiresIn } 秒（前端据此启动倒计时）；dev 模式额外返回 devCode
 * @throws OtpError 频控 / 图形验证码 / 标识不合法时抛出
 */
export async function sendCode(params: {
  identifier: string;
  scene: OtpScene;
  captchaId?: string;
  captchaText?: string;
  ip?: string | null;
}): Promise<{ expiresIn: number; devCode?: string }> {
  // ---------- 步骤 1：识别并归一化标识 ----------
  const resolved = resolveIdentifier(params.identifier);
  if (!resolved) {
    throw new OtpError(
      "请输入正确的邮箱或手机号",
      "IDENTIFIER_INVALID"
    );
  }
  // 用户名无法接收验证码
  if (resolved.field === "username") {
    throw new OtpError(
      "用户名无法接收验证码，请改用邮箱或手机号",
      "OTP_UNSUPPORTED_IDENTIFIER"
    );
  }

  const target = resolved.value;
  const channel = resolved.field === "email" ? "email" : "sms";
  const ip = params.ip ?? null;

  // ---------- 步骤 2：读取频控配置 ----------
  const resendSeconds = await getConfig<number>("auth.otp.resend_seconds");
  const dailyLimit = await getConfig<number>("auth.otp.daily_limit");
  const ttlSeconds = await getConfig<number>("auth.otp.ttl_seconds");
  const captchaRequired = await getConfig<boolean>("auth.captcha.required");

  // ---------- 步骤 3：重发冷却（同 target 最近一次未消费的码） ----------
  const now = new Date();
  const lastCode = await prisma.verificationCode.findFirst({
    where: { target, scene: params.scene },
    orderBy: { createdAt: "desc" },
  });
  if (lastCode) {
    const elapsed = now.getTime() - lastCode.createdAt.getTime();
    if (elapsed < resendSeconds * 1000) {
      const remain = Math.ceil((resendSeconds * 1000 - elapsed) / 1000);
      throw new OtpError(
        `发送过于频繁，请 ${remain} 秒后再试`,
        "OTP_TOO_FREQUENT",
        429
      );
    }
  }

  // ---------- 步骤 4：频次上限（同 target 小时 / 天） ----------
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const hourCount = await prisma.verificationCode.count({
    where: { target, createdAt: { gte: hourAgo } },
  });
  if (hourCount >= HOURLY_LIMIT) {
    throw new OtpError(
      "该账号验证码发送过于频繁，请 1 小时后再试",
      "OTP_HOURLY_LIMIT",
      429
    );
  }

  const dayCount = await prisma.verificationCode.count({
    where: { target, createdAt: { gte: dayAgo } },
  });
  if (dayCount >= dailyLimit) {
    throw new OtpError(
      "该账号今日验证码发送次数已达上限，请明天再试",
      "OTP_DAILY_LIMIT",
      429
    );
  }

  // ---------- 步骤 5：同 IP 频控 ----------
  if (ip) {
    const ipDayCount = await prisma.verificationCode.count({
      where: { requestIp: ip, createdAt: { gte: dayAgo } },
    });
    if (ipDayCount >= IP_DAILY_LIMIT) {
      throw new OtpError(
        "当前网络发送验证码过于频繁，请明天再试",
        "OTP_IP_LIMIT",
        429
      );
    }
  }

  // ---------- 步骤 6：图形验证码判断（同 IP 当日第 N 次起强制） ----------
  if (captchaRequired && ip) {
    const ipTodayCount = await countIpToday(ip);

    if (ipTodayCount >= CAPTCHA_FORCE_THRESHOLD) {
      // 达到阈值：必须校验图形验证码
      if (!params.captchaId || !params.captchaText) {
        throw new OtpError(
          "请先完成图形验证码",
          "CAPTCHA_REQUIRED",
          428
        );
      }
      const captchaOk = verifyCaptcha(params.captchaId, params.captchaText);
      if (!captchaOk) {
        throw new OtpError(
          "图形验证码错误或已过期，请重新获取",
          "CAPTCHA_INVALID"
        );
      }
    }
  }

  // ---------- 步骤 7：生成验证码 + 存哈希 + 下发 ----------
  const code = generateCode();
  const codeHash = hashCode(code, target);

  // 先存库（拿到最新一条记录用于频控统计），再调 Provider 下发
  await prisma.verificationCode.create({
    data: {
      target,
      channel,
      scene: params.scene,
      codeHash,
      expiresAt: new Date(now.getTime() + ttlSeconds * 1000),
      maxAttempts: MAX_ATTEMPTS,
      requestIp: ip,
    },
  });

  // 按通道下发（Provider 内部决定是控制台打印还是真实发送）
  if (channel === "email") {
    await mailProvider.send(target, code, params.scene);
  } else {
    await smsProvider.send(target, code, params.scene);
  }

  return { expiresIn: ttlSeconds };
}

// ============================================================
// 图形验证码必要性预检（供前端「提前展示」用）
// ============================================================

/**
 * 统计同 IP 当日（自然日，从今天 0 点起）已发送验证码的次数。
 *
 * 从 sendCode 的步骤 6 抽出来：预检接口和发送接口要共用同一个口径，
 * 否则「预检说不需要、发送时却要」的边界会更频繁出现。
 */
async function countIpToday(ip: string): Promise<number> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  return prisma.verificationCode.count({
    where: { requestIp: ip, createdAt: { gte: todayStart } },
  });
}

/**
 * 预检：下一次发送验证码是否需要图形验证码。
 *
 * 【为什么要这个接口】
 * 原交互是「用户点获取 → 后端 428 拦截 → 才弹出图形验证码 → 再点一次」，
 * 第一次点击是「白点的」，体验有挫败感。改为前端在进入表单时先调本接口，
 * required=true 就提前展示图形验证码区，用户先完成人机验证再点获取，
 * 一次成功 —— 即「先输入图形验证码，通过后再获取验证码」的顺序。
 *
 * 【阈值为什么是 CAPTCHA_FORCE_THRESHOLD - 1】
 * sendCode 的强制校验条件是「已发送次数 >= 3」（第 3 次发送被拦）。
 * 预检发生在发送之前，想知道的是「下一次发送会不会被拦」，
 * 所以提前 1 次触发：已发送 >= 2 时就前置展示。这样临界的第 3 次
 * 也能走「先验证再获取」的顺序，不会出现「点获取才弹」的漏网情况。
 *
 * @param ip - 客户端 IP（拿不到时永远返回不需要，与 sendCode 口径一致）
 */
export async function getCaptchaStatus(
  ip: string | null
): Promise<{ required: boolean }> {
  const captchaRequired = await getConfig<boolean>("auth.captcha.required");
  if (!captchaRequired || !ip) return { required: false };

  const ipTodayCount = await countIpToday(ip);
  return { required: ipTodayCount >= CAPTCHA_FORCE_THRESHOLD - 1 };
}

// ============================================================
// 校验并消费验证码
// ============================================================

/**
 * 校验并一次性消费验证码。
 *
 * 【校验顺序（每一环失败即拒绝，错误码统一）】
 * 1. 取 target + scene 最近一条未消费的码；
 * 2. 不存在 / 已过期 / 失败次数超限 → 拒绝；
 * 3. 常量时间比对哈希；
 * 4. 失败 → attempts++；成功 → 标记 consumed_at。
 *
 * 【为什么失败后 attempts++ 而不是直接删】
 * 保留失败记录以便「失败 5 次作废」的统计；达到上限后后续校验一律拒绝，
 * 必须重新获取验证码。
 *
 * @param target - 收码目标（已归一化）
 * @param scene  - 业务场景
 * @param code   - 用户输入的验证码
 * @throws OtpError 验证码无效 / 已过期 / 已作废时抛出
 */
export async function verifyAndConsume(
  target: string,
  scene: OtpScene,
  code: string
): Promise<void> {
  const now = new Date();

  // 取最近一条未消费的码
  const record = await prisma.verificationCode.findFirst({
    where: { target, scene, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });

  // 不存在（没发过）或已过期
  if (!record || record.expiresAt <= now) {
    throw new OtpError("验证码无效或已过期", CODE_INVALID);
  }

  // 失败次数超限
  if (record.attempts >= record.maxAttempts) {
    throw new OtpError("验证码错误次数过多，请重新获取", CODE_INVALID);
  }

  // 常量时间比对哈希
  const matched = verifyCode(code, target, record.codeHash);

  if (!matched) {
    // 失败：累计 attempts（达到上限即作废）
    await prisma.verificationCode.update({
      where: { id: record.id },
      data: { attempts: { increment: 1 } },
    });
    throw new OtpError("验证码错误", CODE_INVALID);
  }

  // 成功：标记一次性消费（防重放）
  await prisma.verificationCode.update({
    where: { id: record.id },
    data: { consumedAt: now },
  });
}

// ============================================================
// 图形验证码（转发到 lib/captcha）
// ============================================================

/** 生成图形验证码（供路由层直接调用） */
export { generateCaptcha };
