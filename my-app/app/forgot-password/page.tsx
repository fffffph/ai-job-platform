"use client";

/**
 * ============================================
 * 忘记密码页（Forgot Password）
 * ============================================
 *
 * 【职责】
 * 通过「邮箱/手机号 + 验证码」找回密码：输入收码账号 → 获取验证码 →
 * 输入验证码 + 新密码 → 重置成功跳登录页。
 *
 * 【安全要点】
 * - 验证码 scene=reset_password，与登录验证码隔离，不可混用；
 * - 重置成功后 tokenVersion++ 踢下线，用户需用新密码重新登录；
 * - 图形验证码：同 IP 当日第 3 次起由后端强制，前端自动弹出输入区。
 *
 * 【主题跟随】
 * 与登录页 / 注册页统一走 AuthShell + AuthThemeProvider，颜色全走 CSS 变量。
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Form, Input, Button, Card, App } from "antd";
import { Mail, Smartphone, Lock, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import {
  resetPasswordApi,
  sendCodeApi,
  getCaptchaApi,
  getCaptchaStatusApi,
  getPublicConfigsApi,
  ERROR_MESSAGES,
} from "@/api";
import type { PublicConfigMap } from "@/api";
import { resolveIdentifier } from "@/lib/identifier";
import { AuthThemeProvider, AuthShell } from "@/components/auth/AuthShell";

/** 公开配置兜底默认值 */
const CONFIG_FALLBACK = {
  minLength: 8,
  resendSeconds: 60,
} as const;

interface CaptchaState {
  captchaId: string;
  svg: string;
}

const ForgotPasswordContent = () => {
  const { message } = App.useApp();
  const [form] = Form.useForm<{ identifier: string; code: string; password: string; confirm: string }>();
  const router = useRouter();

  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [captcha, setCaptcha] = useState<CaptchaState | null>(null);
  const [captchaText, setCaptchaText] = useState("");

  /** 密码最小长度 / 重发冷却（来自服务端公开配置） */
  const [minLength, setMinLength] = useState<number>(CONFIG_FALLBACK.minLength);
  const [resendSeconds, setResendSeconds] = useState<number>(CONFIG_FALLBACK.resendSeconds);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 读取公开配置
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await getPublicConfigsApi();
      if (cancelled || !res.success || !res.data) return;
      const data = res.data as PublicConfigMap;
      if (typeof data["auth.password.min_length"] === "number") {
        setMinLength(data["auth.password.min_length"]);
      }
      if (typeof data["auth.otp.resend_seconds"] === "number") {
        setResendSeconds(data["auth.otp.resend_seconds"]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 清理定时器
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const identifier = Form.useWatch<string>("identifier", form) ?? "";
  const detected = useMemo(() => resolveIdentifier(identifier), [identifier]);

  /** 启动倒计时 */
  const startCountdown = useCallback(() => {
    setCountdown(resendSeconds);
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
  }, [resendSeconds]);

  /** 拉取图形验证码 */
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
   * required=true 提前展示图形验证码区，用户先完成人机验证再点
   * 「获取验证码」，一次成功；预检失败按「不需要」处理，
   * 发送时后端仍有兜底校验。
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

  /** 获取验证码 */
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
      scene: "reset_password",
      captchaId: captcha?.captchaId,
      captchaText: captcha ? captchaText : undefined,
    });
    setSending(false);

    if (res.success) {
      message.success("验证码已发送，请查收");
      setCaptcha(null);
      startCountdown();
      return;
    }

    const code = res.code;
    message.error(code ? ERROR_MESSAGES[code] || res.message : res.message);
    if (code === "CAPTCHA_REQUIRED" || code === "CAPTCHA_INVALID") {
      await refreshCaptcha();
    }
  }, [identifier, captcha, captchaText, message, refreshCaptcha, startCountdown]);

  /** 提交重置密码 */
  const handleSubmit = useCallback(async () => {
    const raw = (identifier ?? "").trim();
    const code = (form.getFieldValue("code") ?? "").trim();
    const password = form.getFieldValue("password") ?? "";
    const confirm = form.getFieldValue("confirm") ?? "";

    if (!raw || !code || !password) {
      message.error("请填写完整信息");
      return;
    }
    if (password !== confirm) {
      message.error("两次输入的密码不一致");
      return;
    }

    setLoading(true);
    const res = await resetPasswordApi({
      identifier: raw,
      code,
      newPassword: password,
    });
    setLoading(false);

    if (!res.success) {
      message.error(res.code ? ERROR_MESSAGES[res.code] || res.message : res.message);
      return;
    }

    message.success("密码已重置，请使用新密码登录");
    router.replace("/login");
  }, [identifier, form, message, router]);

  const identifierIcon = useMemo(() => {
    const cls = "w-4 h-4 text-muted-foreground mr-2";
    if (detected?.field === "phone") return <Smartphone className={cls} />;
    return <Mail className={cls} />;
  }, [detected]);

  const passwordHint = useMemo(
    () => `至少 ${minLength} 位，且需同时包含字母和数字`,
    [minLength]
  );

  return (
    <AuthShell maxWidth={440}>
      <Card className="auth-card" styles={{ body: { padding: "2.5rem 2rem" } }}>
        <div className="text-center mb-8">
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-b from-foreground to-foreground/60 bg-clip-text text-transparent mb-2">
              找回密码
            </h1>
            <p className="text-sm font-medium text-muted-foreground">
              通过邮箱或手机号验证码重置密码
            </p>
          </motion.div>
        </div>

        <Form form={form} layout="vertical" size="large" requiredMark={false} autoComplete="off">
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
                  inputMode="numeric"
                  className="flex-1"
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

          {/* 新密码 */}
          <Form.Item
            name="password"
            label={
              <span className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">
                新密码
              </span>
            }
            extra={
              <span className="text-[11px] text-muted-foreground leading-relaxed">
                {passwordHint}
              </span>
            }
            rules={[
              { required: true, message: "请设置新密码" },
              { min: minLength, message: `密码长度不能少于 ${minLength} 位` },
              {
                validator: (_rule, value: string) => {
                  if (!value) return Promise.resolve();
                  if (!/[a-zA-Z]/.test(value) || !/\d/.test(value)) {
                    return Promise.reject(new Error("密码需同时包含字母和数字"));
                  }
                  return Promise.resolve();
                },
              },
            ]}
          >
            <Input.Password
              prefix={<Lock className="w-4 h-4 text-muted-foreground mr-2" />}
              placeholder="••••••••"
              autoComplete="new-password"
            />
          </Form.Item>

          {/* 确认密码 */}
          <Form.Item
            name="confirm"
            label={
              <span className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">
                确认新密码
              </span>
            }
            dependencies={["password"]}
            rules={[
              { required: true, message: "请再次输入新密码" },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue("password") === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error("两次输入的密码不一致"));
                },
              }),
            ]}
          >
            <Input.Password
              prefix={<Lock className="w-4 h-4 text-muted-foreground mr-2" />}
              placeholder="••••••••"
              autoComplete="new-password"
            />
          </Form.Item>

          <Form.Item className="mt-6 mb-0">
            <Button
              type="primary"
              block
              loading={loading}
              onClick={handleSubmit}
              className="bg-blue-600 hover:bg-blue-500 border-none font-bold tracking-wide"
            >
              {loading ? "重置中..." : "重置密码"}
            </Button>
          </Form.Item>

          <div className="mt-8 pt-6 border-t border-border text-center">
            <Link
              href="/login"
              className="text-muted-foreground hover:text-blue-500 transition-all inline-flex items-center text-sm"
            >
              <ArrowLeft className="w-4 h-4 mr-1.5" />
              返回登录
            </Link>
          </div>
        </Form>
      </Card>

      <div className="mt-8 text-center text-[11px] tracking-widest uppercase text-muted-foreground opacity-70">
        © 2026 CareerAI Technology
      </div>
    </AuthShell>
  );
};

const ForgotPasswordPage = () => {
  return (
    <AuthThemeProvider>
      <ForgotPasswordContent />
    </AuthThemeProvider>
  );
};

export default ForgotPasswordPage;
