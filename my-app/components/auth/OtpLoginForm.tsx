"use client";

/**
 * ============================================
 * 验证码登录表单（OtpLoginForm）
 * ============================================
 *
 * 【职责】
 * 登录页「验证码登录」Tab 的完整表单：邮箱/手机号 → 获取验证码（60s 倒计时）
 * → 输入验证码 → 登录。配套图形验证码：同 IP 当日第 3 次起强制，此时
 * 表单会**提前展示**图形验证码输入区，用户先完成人机验证再点「获取验证码」。
 *
 * 【与密码登录的差异】
 * - 免密：不校验密码，验证码通过即登录（未注册时由后端按开关自动注册）；
 * - 收码通道：只支持邮箱/手机号（用户名无收码通道，后端会拒绝）。
 *
 * 【图形验证码的交互设计】
 * 不做「每次都弹」——体验差。挂载时先调 captcha-status 预检：已触达阈值
 * 就直接展示图形验证码区，用户先填好再点获取，一次成功（先验证后获取）；
 * 未触达阈值则不展示，正常用户无感。若预检与实际发送之间计数变化导致
 * 后端返回 CAPTCHA_REQUIRED（428），兜底再展示——属于罕见边界。
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Form, Input, Button, App } from "antd";
import { Mail, Smartphone, MessageSquareText } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  loginByCodeApi,
  sendCodeApi,
  getCaptchaApi,
  getCaptchaStatusApi,
  setToken,
  ERROR_MESSAGES,
} from "@/api";
import type { PublicConfigMap } from "@/api";
import { resolveIdentifier } from "@/lib/identifier";

interface OtpLoginFormProps {
  /** 服务端公开配置（决定倒计时秒数等） */
  config: Required<PublicConfigMap>;
}

/** 图形验证码状态 */
interface CaptchaState {
  captchaId: string;
  svg: string;
}

const OtpLoginForm: React.FC<OtpLoginFormProps> = ({ config }) => {
  const { message } = App.useApp();
  const router = useRouter();
  const [form] = Form.useForm<{ identifier: string; code: string }>();

  const [sending, setSending] = useState(false);
  const [logging, setLogging] = useState(false);
  /** 重发倒计时（秒），>0 时「获取验证码」按钮禁用并显示剩余秒数 */
  const [countdown, setCountdown] = useState(0);
  /** 图形验证码（后端要求时才出现） */
  const [captcha, setCaptcha] = useState<CaptchaState | null>(null);
  const [captchaText, setCaptchaText] = useState("");

  // 实时识别标识类型，用于切换输入框前缀图标
  const identifier = Form.useWatch<string>("identifier", form) ?? "";
  const detected = useMemo(() => resolveIdentifier(identifier), [identifier]);

  // 倒计时定时器引用（组件卸载时清理）
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /** 清理倒计时定时器 */
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  /**
   * 启动 60 秒（或配置值）倒计时。
   *
   * 用 setInterval 每秒递减；归零后清除定时器。
   */
  const startCountdown = useCallback(() => {
    const seconds = config["auth.otp.resend_seconds"] || 60;
    setCountdown(seconds);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [config]);

  /**
   * 拉取一张新的图形验证码。
   */
  const refreshCaptcha = useCallback(async () => {
    const res = await getCaptchaApi();
    if (res.success && res.data) {
      setCaptcha({ captchaId: res.data.captchaId, svg: res.data.svg });
      setCaptchaText("");
    }
  }, []);

  /**
   * 挂载时预检：下一次发送是否需要图形验证码。
   *
   * required=true 说明本 IP 当日发送次数已触达阈值，提前拉取并展示
   * 图形验证码区——用户先完成人机验证再点「获取验证码」，一次成功，
   * 而不是点了获取才被 428 拦截。预检失败按「不需要」处理，
   * 发送时后端仍有兜底校验，不影响正常用户。
   */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await getCaptchaStatusApi();
      if (cancelled || !res.success || !res.data?.required) return;
      await refreshCaptcha();
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshCaptcha]);

  /**
   * 点击「获取验证码」。
   *
   * 流程：
   * 1. 校验标识格式（邮箱/手机号）；
   * 2. 调 sendCodeApi（若已展示图形验证码，则带上 captchaId + captchaText）；
   * 3. 成功 → 启动倒计时 + 关闭图形验证码区；
   * 4. 返回 CAPTCHA_REQUIRED → 拉取并展示图形验证码（预检漏网的兜底）；
   * 5. 返回 CAPTCHA_INVALID → 刷新图形验证码，提示重试。
   */
  const handleSendCode = useCallback(async () => {
    const raw = (identifier ?? "").trim();
    if (!raw) {
      message.error("请先输入邮箱或手机号");
      return;
    }
    const hit = resolveIdentifier(raw);
    if (!hit) {
      message.error("请输入正确的邮箱或手机号");
      return;
    }
    if (hit.field === "username") {
      message.error("用户名无法接收验证码，请改用邮箱或手机号");
      return;
    }

    setSending(true);
    const res = await sendCodeApi({
      identifier: raw,
      scene: "login",
      captchaId: captcha?.captchaId,
      captchaText: captcha ? captchaText : undefined,
    });
    setSending(false);

    if (res.success) {
      message.success("验证码已发送，请查收");
      setCaptcha(null); // 发送成功，收起图形验证码区
      startCountdown();
      return;
    }

    const code = res.code;
    const msg = code ? ERROR_MESSAGES[code] || res.message : res.message;
    message.error(msg);

    // 需要图形验证码：拉取并展示
    if (code === "CAPTCHA_REQUIRED") {
      await refreshCaptcha();
    }
    // 图形验证码错误：刷新一张新的
    if (code === "CAPTCHA_INVALID") {
      await refreshCaptcha();
    }
  }, [identifier, captcha, captchaText, message, refreshCaptcha, startCountdown]);

  /**
   * 提交验证码登录。
   *
   * 成功后与密码登录同构：存 Token → 按 mustChangePassword 分流。
   */
  const handleLogin = useCallback(async () => {
    const raw = (identifier ?? "").trim();
    const code = (form.getFieldValue("code") ?? "").trim();

    if (!raw || !code) {
      message.error("请输入邮箱/手机号和验证码");
      return;
    }

    setLogging(true);
    const res = await loginByCodeApi({ identifier: raw, code });
    setLogging(false);

    if (!res.success) {
      const msg = res.code ? ERROR_MESSAGES[res.code] || res.message : res.message;
      message.error(msg);
      return;
    }

    // 登录成功：存储 Token（验证码登录默认会话级，不持久化）
    setToken(res.data.token, false);

    if (res.data.user.mustChangePassword) {
      message.warning("该账号需先修改初始密码");
      router.replace("/change-password");
      return;
    }

    message.success(
      `登录成功！欢迎回来，${res.data.user.name || res.data.user.username || raw}`
    );
    router.push("/dashboard");
  }, [identifier, form, message, router]);

  // 输入框前缀图标
  const identifierIcon = useMemo(() => {
    const cls = "w-4 h-4 text-muted-foreground mr-2";
    if (detected?.field === "email") return <Mail className={cls} />;
    if (detected?.field === "phone") return <Smartphone className={cls} />;
    return <MessageSquareText className={cls} />;
  }, [detected]);

  return (
    <Form form={form} layout="vertical" size="large" requiredMark={false}>
      {/* 收码账号 */}
      <Form.Item
        name="identifier"
        label={
          <span className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">
            邮箱 / 手机号
          </span>
        }
        rules={[
          { required: true, message: "请输入邮箱或手机号" },
          {
            validator: (_rule, value: string) => {
              if (!value) return Promise.resolve();
              const hit = resolveIdentifier(value);
              if (!hit) {
                return Promise.reject(new Error("请输入正确的邮箱或手机号"));
              }
              if (hit.field === "username") {
                return Promise.reject(
                  new Error("用户名无法接收验证码，请改用邮箱或手机号")
                );
              }
              return Promise.resolve();
            },
          },
        ]}
      >
        <Input
          prefix={identifierIcon}
          placeholder="用于接收验证码的邮箱或手机号"
          autoComplete="off"
        />
      </Form.Item>

      {/* 验证码 + 获取按钮 */}
      <Form.Item
        label={
          <span className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">
            验证码
          </span>
        }
        required
      >
        <div className="flex gap-2">
          <Form.Item name="code" noStyle rules={[{ required: true, message: "请输入验证码" }]}>
            <Input
              placeholder="6 位验证码"
              maxLength={6}
              autoComplete="one-time-code"
              className="flex-1"
              inputMode="numeric"
            />
          </Form.Item>
          <Button
            onClick={handleSendCode}
            loading={sending}
            disabled={countdown > 0}
            style={{ minWidth: 128 }}
          >
            {countdown > 0 ? `${countdown}s 后重发` : "获取验证码"}
          </Button>
        </div>
      </Form.Item>

      {/* 图形验证码（触达频控阈值时提前展示；需先填对再点获取） */}
      {captcha && (
        <div className="mb-4 rounded-lg border border-border p-3">
          <p className="mb-2 text-xs text-muted-foreground">
            为保障账号安全，请先完成人机验证，再点击「获取验证码」
          </p>
          <div className="flex items-center gap-3">
            {/* SVG 图片：点击刷新 */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`data:image/svg+xml;utf8,${encodeURIComponent(captcha.svg)}`}
              alt="图形验证码"
              title="点击刷新"
              onClick={refreshCaptcha}
              className="h-12 cursor-pointer rounded border border-border"
            />
            <Input
              value={captchaText}
              onChange={(e) => setCaptchaText(e.target.value)}
              placeholder="输入图形验证码"
              maxLength={4}
              autoComplete="off"
              onPressEnter={handleSendCode}
            />
          </div>
        </div>
      )}

      {/* 登录按钮 */}
      <Button
        type="primary"
        block
        loading={logging}
        onClick={handleLogin}
        className="bg-blue-600 hover:bg-blue-500 border-none font-bold tracking-wide"
        style={{ marginTop: 8 }}
      >
        {logging ? "登录中..." : "立即登录"}
      </Button>
    </Form>
  );
};

export default OtpLoginForm;
