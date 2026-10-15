"use client";

/**
 * ============================================
 * 强制修改初始密码页（/change-password）
 * ============================================
 *
 * 【这个页面解决什么问题】
 * 管理员在「用户管理 → 新增用户」里开启「首次登录强制修改密码」后，
 * 该账号用初始密码登录成功，但**必须先改密码**才能使用系统其它功能。
 *
 * 【为什么单独做一个顶层路由，而不是放在 dashboard 下】
 * 放在 /dashboard/* 下会被 dashboard 布局套上侧边栏和顶部导航，
 * 用户点一下菜单就能溜进别的模块，强制形同虚设。
 * 放在顶层则是一个「没有出口」的独立页面，只有两个动作：
 * 改密码，或者退出登录。
 *
 * 【强制是四层叠加的，缺任一层都能被绕过】
 * 1. 后端 authMiddleware 闸门：改密前调其它接口一律 403
 *    （这是唯一真正拦得住的一层，手敲 URL / curl 都绕不过）
 * 2. 登录页分流：登录响应里 mustChangePassword=true → 直接送到本页
 * 3. api/client.ts 拦截器：收到 403 PASSWORD_CHANGE_REQUIRED → 送到本页
 * 4. 本页挂载时自检：调 GET /api/user/profile 核实标记，
 *    若已经改过（false）就直接放进 dashboard，避免用户被历史链接卡住
 *
 * 【改完密码后为什么跳回登录页】
 * 后端 changePassword 会执行 tokenVersion++，把**所有**旧 Token 立即吊销
 * （包括当前这一次会话的），因此改完密码后本地 Token 必然失效，必须重新登录。
 * 与其让用户懵在原地吃 401，不如主动清掉 Token 并明确告诉他「请用新密码登录」。
 *
 * 【主题跟随】
 * 与登录页统一走 AuthShell + AuthThemeProvider：背景 / 卡片 / 文字全部用
 * CSS 变量，antd 算法随 next-themes 切换，不再写死暗色。
 */

import React, { useCallback, useEffect, useState } from "react";
import { Form, Input, Button, Card, App, Alert, Tag, Skeleton } from "antd";
import {
  Lock,
  ShieldCheck,
  LogOut,
  KeyRound,
  Mail,
  Smartphone,
  User as UserIcon,
  AtSign,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  getUserProfile,
  changePassword,
  removeToken,
  getPublicConfigsApi,
  ERROR_MESSAGES,
} from "@/api";
import type { UserProfile } from "@/api";
import {
  validatePassword,
  passwordRuleHint,
  DEFAULT_PASSWORD_MIN_LENGTH,
} from "@/lib/password";
import { AuthThemeProvider, AuthShell } from "@/components/auth/AuthShell";

/**
 * 密码最小长度的兜底值。
 *
 * 真实值优先取服务端公开配置 `auth.password.min_length`；
 * 取不到时用 8。注意后端是权威判定方，这里只负责即时反馈，
 * 因此兜底值偏小/偏大最多影响体验，不会造成安全问题。
 */
const FALLBACK_MIN_LENGTH = DEFAULT_PASSWORD_MIN_LENGTH;

/** 表单字段类型 */
interface ChangePasswordFormValues {
  oldPassword: string;
  newPassword: string;
  confirmPassword: string;
}

const ChangePasswordContent = () => {
  const { message } = App.useApp();
  const [form] = Form.useForm<ChangePasswordFormValues>();
  const router = useRouter();

  /** 是否仍在做「前置自检」（拉资料 + 读配置） */
  const [checking, setChecking] = useState(true);
  /** 自检失败时的提示（通常是 Token 失效） */
  const [error, setError] = useState<string | null>(null);
  /** 当前登录用户的公开信息（用于展示「你在改哪个账号的密码」） */
  const [profile, setProfile] = useState<UserProfile | null>(null);
  /** 提交中 */
  const [submitting, setSubmitting] = useState(false);
  /** 密码最小长度（来自服务端公开配置） */
  const [minLength, setMinLength] = useState(FALLBACK_MIN_LENGTH);

  // ============================================================
  // 前置自检：拉当前账号资料 + 读密码策略配置
  // ============================================================
  useEffect(() => {
    let cancelled = false;

    (async () => {
      // 两个请求互不依赖，并行发；配置失败不影响主流程（用兜底值）
      const [profileRes, configRes] = await Promise.all([
        getUserProfile(),
        getPublicConfigsApi(),
      ]);

      if (cancelled) return;

      // ---------- 密码策略：只影响提示文案与即时校验 ----------
      const remoteMinLength = configRes.success
        ? Number(configRes.data?.["auth.password.min_length"])
        : NaN;
      if (Number.isFinite(remoteMinLength) && remoteMinLength > 0) {
        setMinLength(remoteMinLength);
      }

      // ---------- 账号资料：决定是「展示表单」还是「放行」 ----------
      if (!profileRes.success) {
        // 401 的情况拦截器已经接管（清 Token + 送登录页），这里只需兜住 UI，
        // 避免出现「白屏」让用户不知道发生了什么。
        setError(profileRes.message || "无法获取账号信息，请重新登录");
        setChecking(false);
        return;
      }

      if (!profileRes.data.mustChangePassword) {
        // 已经改过密码（或本就是正常账号）→ 说明用户是通过历史链接/手敲地址进来的，
        // 直接放行进应用，不要拿一个已经完成的流程拦住他。
        router.replace("/dashboard");
        return;
      }

      setProfile(profileRes.data);
      setChecking(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  // ============================================================
  // 提交修改
  // ============================================================
  const handleSubmit = useCallback(
    async (values: ChangePasswordFormValues) => {
      setSubmitting(true);

      const res = await changePassword({
        oldPassword: values.oldPassword,
        newPassword: values.newPassword,
      });

      if (res.success) {
        /**
         * 【改完回登录页重新登录（保持不变）】
         *
         * 后端 changePassword 会 `tokenVersion++` 吊销所有旧 Token（含本次会话的），
         * 本地那份继续留着只会让用户在下一次请求时吃一个莫名其妙的 401。
         * 这里主动清掉，并带 `?passwordChanged=1` 跳登录页，
         * 让用户用刚设置的新密码正式登录一次，确认新密码可用。
         */
        removeToken();

        message.success("初始密码已修改，请使用新密码重新登录");
        router.replace("/login?passwordChanged=1");
        return;
      }

      const errorMsg = res.code
        ? ERROR_MESSAGES[res.code] || res.message
        : res.message;
      message.error(errorMsg);
      setSubmitting(false);
    },
    [message, router]
  );

  // ============================================================
  // 退出登录（本页唯一的「出口」，防止改不了密码的账号被锁死）
  // ============================================================
  const handleLogout = useCallback(() => {
    removeToken();
    message.success("已退出登录");
    router.replace("/login");
  }, [message, router]);

  /** 当前账号用了哪些登录标识（邮箱 / 手机号 / 用户名）——全部列出，便于用户确认 */
  const identities = profile
    ? (
        [
          { key: "username", label: "用户名", value: profile.username, Icon: UserIcon },
          { key: "email", label: "邮箱", value: profile.email, Icon: Mail },
          { key: "phone", label: "手机号", value: profile.phone, Icon: Smartphone },
        ] as const
      ).filter((item) => Boolean(item.value))
    : [];

  return (
    <AuthShell maxWidth={520}>
      <Card className="auth-card" styles={{ body: { padding: "2rem" } }}>
        {/* ---------- 标题区 ---------- */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-blue-500/10 border border-blue-500/20 mb-4">
            <ShieldCheck className="w-6 h-6 text-blue-500" />
          </div>
          <h1 className="text-2xl font-bold mb-2 tracking-tight text-foreground">
            请先修改初始密码
          </h1>
          <p className="text-muted-foreground text-sm leading-relaxed">
            该账号由管理员创建，出于安全考虑，
            <br />
            修改初始密码后才能使用系统其它功能。
          </p>
        </div>

        {/* ---------- 自检中 ---------- */}
        {checking && (
          <div className="py-2">
            <Skeleton active paragraph={{ rows: 3 }} />
          </div>
        )}

        {/* ---------- 自检失败 ---------- */}
        {!checking && error && (
          <div className="space-y-5">
            <Alert
              type="error"
              showIcon
              title={error}
              description="请重新登录后再试。"
            />
            <Button block icon={<LogOut className="w-4 h-4" />} onClick={handleLogout}>
              返回登录页
            </Button>
          </div>
        )}

        {/* ---------- 正常流程 ---------- */}
        {!checking && !error && profile && (
          <>
            {/* 当前账号：让用户清楚「我改的是哪个账号的密码」 */}
            <div className="mb-6 rounded-xl border border-border bg-muted/50 px-4 py-3">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
                当前账号
              </div>
              <div className="flex flex-wrap gap-2">
                {identities.length > 0 ? (
                  identities.map(({ key, label, value, Icon }) => (
                    <Tag
                      key={key}
                      icon={<Icon className="w-3 h-3" />}
                      style={{
                        margin: 0,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        fontSize: 12,
                      }}
                    >
                      {label}：{value}
                    </Tag>
                  ))
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <AtSign className="w-3 h-3" />
                    {profile.name || "未设置昵称"}
                  </span>
                )}
              </div>
            </div>

            <Form
              form={form}
              layout="vertical"
              onFinish={handleSubmit}
              requiredMark={false}
              autoComplete="off"
            >
              {/* 旧密码：账号是管理员用初始密码建出来的，用户必然知道它 */}
              <Form.Item
                name="oldPassword"
                label={
                  <span className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">
                    初始密码（当前密码）
                  </span>
                }
                rules={[{ required: true, message: "请输入初始密码" }]}
              >
                <Input.Password
                  prefix={<Lock className="w-4 h-4 text-muted-foreground mr-2" />}
                  placeholder="请输入管理员给你的初始密码"
                  autoComplete="current-password"
                  className="hover:border-blue-500/50 focus:border-blue-500 transition-all"
                />
              </Form.Item>

              {/* 新密码：即时按统一策略校验（与后端同一套规则） */}
              <Form.Item
                name="newPassword"
                label={
                  <span className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">
                    新密码
                  </span>
                }
                extra={
                  <span className="text-muted-foreground text-xs">
                    {passwordRuleHint(minLength)}
                  </span>
                }
                rules={[
                  {
                    validator: (_rule, value: string) => {
                      const err = validatePassword(value ?? "", minLength);
                      return err ? Promise.reject(new Error(err)) : Promise.resolve();
                    },
                  },
                ]}
              >
                <Input.Password
                  prefix={<KeyRound className="w-4 h-4 text-muted-foreground mr-2" />}
                  placeholder="设置一个新的密码"
                  autoComplete="new-password"
                  className="hover:border-blue-500/50 focus:border-blue-500 transition-all"
                />
              </Form.Item>

              <Form.Item
                name="confirmPassword"
                label={
                  <span className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">
                    确认新密码
                  </span>
                }
                dependencies={["newPassword"]}
                rules={[
                  { required: true, message: "请再次输入新密码" },
                  ({ getFieldValue }) => ({
                    validator(_rule, value) {
                      if (!value || getFieldValue("newPassword") === value) {
                        return Promise.resolve();
                      }
                      return Promise.reject(new Error("两次输入的密码不一致"));
                    },
                  }),
                ]}
              >
                <Input.Password
                  prefix={<KeyRound className="w-4 h-4 text-muted-foreground mr-2" />}
                  placeholder="再次输入新密码"
                  autoComplete="new-password"
                  className="hover:border-blue-500/50 focus:border-blue-500 transition-all"
                />
              </Form.Item>

              <Form.Item className="mb-0">
                <Button
                  type="primary"
                  htmlType="submit"
                  block
                  loading={submitting}
                  icon={<ShieldCheck className="w-4 h-4" />}
                  className="bg-blue-600 hover:bg-blue-500 border-none font-bold tracking-wide"
                >
                  {submitting ? "提交中..." : "确认修改并重新登录"}
                </Button>
              </Form.Item>
            </Form>

            {/* 唯一的出口：不能改密码的账号（例如忘了初始密码）也能走人 */}
            <div className="mt-6 pt-5 border-t border-border text-center">
              <Button
                type="text"
                size="small"
                icon={<LogOut className="w-3.5 h-3.5" />}
                onClick={handleLogout}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                退出登录，换个账号
              </Button>
            </div>
          </>
        )}
      </Card>
    </AuthShell>
  );
};

const ChangePasswordPage = () => {
  return (
    <AuthThemeProvider>
      <ChangePasswordContent />
    </AuthThemeProvider>
  );
};

export default ChangePasswordPage;
