"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Form,
  Input,
  Button,
  Checkbox,
  Card,
  App,
  Segmented,
  Alert,
  Tag,
} from "antd";
import {
  Mail,
  Lock,
  LogIn,
  UserPlus,
  Smartphone,
  User as UserIcon,
  AtSign,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { loginApi, setToken, ERROR_MESSAGES, getPublicConfigsApi } from "@/api";
import type { PublicConfigMap } from "@/api";
import { resolveIdentifier, IDENTIFIER_LABELS } from "@/lib/identifier";
import { AuthThemeProvider, AuthShell } from "@/components/auth/AuthShell";

/**
 * 登录页 —— 统一登录入口 + 跟随系统主题
 *
 * 【改造要点（A-P0）】
 * 1. 单一智能输入框：一个「账号」输入框，邮箱 / 手机号 / 用户名都能填，
 *    前端实时识别并切换图标与提示，但**只做提示、不做字段拆分**——
 *    始终把原文以 identifier 交给后端，由后端做权威判定，
 *    避免前后端判定规则漂移导致的诡异登录失败。
 * 2. 配置驱动：登录方式（密码 / 验证码）、是否开放注册、密码最小长度
 *    全部来自 GET /api/config/public（免登录白名单接口），
 *    管理员在「系统设置 → 登录与账号」改开关，登录页即时变化。
 *
 * 【改造要点（主题跟随）】
 * 旧版把背景写死成 `bg-[#050505]`、文字写死成 `text-white/xx`，等于永远暗色 ——
 * 用户在系统设置里切了浅色，一进登录页又变回全黑，前后割裂。
 * 现在整页交给 AuthShell + AuthThemeProvider：
 * 颜色全部走 CSS 变量（--background / --foreground / --card / --border /
 * --muted-foreground），antd 算法随 next-themes 的 theme 切换，一份代码两套主题。
 */

/** 公开配置读取失败时的兜底默认值（保证登录页永远可用） */
const CONFIG_FALLBACK: Required<PublicConfigMap> = {
  "auth.register.enabled": true,
  "auth.login.password": true,
  "auth.login.username": true,
  "auth.login.phone": false,
  "auth.login.email_otp": false,
  "auth.login.sms_otp": false,
  "auth.login.otp_auto_register": false,
  "auth.captcha.required": true,
  "auth.otp.ttl_seconds": 300,
  "auth.otp.resend_seconds": 60,
  "auth.password.min_length": 8,
};

/** 登录方式 Tab */
type LoginTab = "password" | "otp";

const LoginContent = () => {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  /** 服务端下发的公开配置（决定展示哪些登录方式） */
  const [config, setConfig] = useState<Required<PublicConfigMap>>(CONFIG_FALLBACK);
  const [activeTab, setActiveTab] = useState<LoginTab>("password");

  /**
   * 是否是「刚改完初始密码被弹回来」的场景。
   *
   * 强制改密页成功后无法在原地弹提示（它会清 Token 并跳到这里），
   * 所以改用 `?passwordChanged=1` 把这件事带过来，由登录页展示。
   */
  const [passwordChangedNotice, setPasswordChangedNotice] = useState(false);

  // ============================================================
  // 读取「密码已修改」的一次性提示
  // ============================================================
  useEffect(() => {
    // 【为什么不用 useSearchParams】
    // Next App Router 要求 useSearchParams 必须包在 Suspense 边界里，
    // 否则构建时会报 "should be wrapped in a suspense boundary"。
    // 这里只是读一次性参数，直接从 location 读更省事、也没有边界问题。
    //
    // 【为什么包一层 async IIFE】
    // 项目启用了 React Compiler 的 lint 规则 react-hooks/set-state-in-effect，
    // 在 effect 体内同步 setState 会被拦下；放到微任务里则与现有
    // 「加载公开配置」的写法保持一致。
    (async () => {
      const params = new URLSearchParams(window.location.search);
      if (params.get("passwordChanged") !== "1") return;

      setPasswordChangedNotice(true);
      // 立刻把参数从地址栏抹掉：否则用户每次刷新都会再看到一次这个提示
      window.history.replaceState(null, "", "/login");
    })();
  }, []);

  /** 实时监听账号输入，用于切换图标与提示（不做字段拆分） */
  const identifier = Form.useWatch<string>("identifier", form) ?? "";
  const detected = useMemo(() => resolveIdentifier(identifier), [identifier]);

  // ============================================================
  // 加载公开配置（免登录接口）
  // ============================================================
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await getPublicConfigsApi();
      if (cancelled || !res.success || !res.data) return;
      // 逐项合并：接口返回的键覆盖兜底值，缺失项保持默认，
      // 避免后端新增/删除配置项时登录页因字段缺失而崩。
      setConfig({ ...CONFIG_FALLBACK, ...res.data });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** 可用的登录方式数量（决定是否显示方式切换器） */
  const otpEnabled =
    config["auth.login.email_otp"] || config["auth.login.sms_otp"];
  const showSwitcher = otpEnabled && config["auth.login.password"];

  /**
   * 账号输入框的动态前缀图标与提示文案。
   *
   * 仅做视觉反馈：识别为手机号就显示手机图标，识别为邮箱就显示信封图标。
   * 图标颜色用 --muted-foreground，明暗主题下都保持「次要信息」的观感。
   */
  const accountIcon = useMemo(() => {
    const cls = "w-4 h-4 text-muted-foreground mr-2";
    if (!identifier.trim()) return <AtSign className={cls} />;
    if (!detected) return <AtSign className={cls} />;
    if (detected.field === "email") return <Mail className={cls} />;
    if (detected.field === "phone") return <Smartphone className={cls} />;
    return <UserIcon className={cls} />;
  }, [identifier, detected]);

  /** 输入框下方的实时提示（识别出类型才显示，避免噪音） */
  const accountHint = useMemo(() => {
    if (!detected) return null;
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Tag
          color="blue"
          style={{ margin: 0, fontSize: 11, lineHeight: "16px", padding: "0 6px" }}
        >
          已识别
        </Tag>
        将按「{IDENTIFIER_LABELS[detected.field]}」登录
      </span>
    );
  }, [detected]);

  /**
   * 表单提交处理
   *
   * 流程：
   * 1. 设置 loading 状态（禁用按钮，防止重复提交）
   * 2. 调用 loginApi 发起 POST /api/auth/login
   * 3. 成功 → 存 Token → 按 mustChangePassword 分流
   * 4. 失败 → 优先使用错误码对应的中文提示
   */
  const onFinish = useCallback(
    async (values: {
      identifier: string;
      password: string;
      remember?: boolean;
    }) => {
      setLoading(true);

      // 原样把用户输入交给后端（不拆分字段），由后端 resolveIdentifier 权威判定
      const res = await loginApi({
        identifier: values.identifier,
        password: values.password,
      });

      if (res.success) {
        // 登录成功：存储 Token 到本地（勾选「记住我」才持久化，否则会话级）
        setToken(res.data.token, values.remember);

        /**
         * 「首次登录强制修改密码」分流（A-P0 补完）。
         *
         * 管理员建号时开了这个开关，用户必须先把初始密码改掉。
         * 这里直接把他送到强制改密页（顶层路由，没有侧边栏可以溜走）。
         *
         * 【注意这只是第一层】
         * 真正的拦截在后端 authMiddleware：改密前调任何其它接口都会吃
         * 403 PASSWORD_CHANGE_REQUIRED。所以即使有人绕过这个跳转，
         * 手敲 /dashboard/xxx 也进不去（会被 axios 拦截器送回改密页）。
         */
        if (res.data.user.mustChangePassword) {
          message.warning("该账号需先修改初始密码");
          // 这里不 setLoading(false)：保持按钮 loading 直到页面切走，
          // 避免按钮闪回可用态、用户误以为没响应又点一次。
          router.replace("/change-password");
          return;
        }

        message.success(
          `登录成功！欢迎回来，${res.data.user.name || res.data.user.username || values.identifier}`
        );
        router.push("/dashboard");
      } else {
        // 登录失败：优先使用错误码对应的中文提示
        const msg = res.code ? ERROR_MESSAGES[res.code] || res.message : res.message;
        message.error(msg);
      }

      setLoading(false);
    },
    [message, router]
  );

  return (
    <AuthShell maxWidth={420}>
      <Card className="auth-card" styles={{ body: { padding: "2rem" } }}>
        <div className="text-center mb-6">
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-b from-foreground to-foreground/60 bg-clip-text text-transparent mb-2">
              账号登录
            </h1>
            <p className="text-sm font-medium text-muted-foreground">
              开启您的 AI 职业生涯新篇章
            </p>
          </motion.div>
        </div>

        {/* 刚改完初始密码被弹回来的成功提示（一次性，读后即从地址栏抹掉） */}
        {passwordChangedNotice && (
          <div className="mb-5">
            <Alert
              type="success"
              showIcon
              closable
              title="初始密码已修改"
              description={
                <span className="text-xs leading-relaxed">
                  请使用新密码重新登录。为安全起见，改密时已注销该账号的全部登录状态。
                </span>
              }
              onClose={() => setPasswordChangedNotice(false)}
            />
          </div>
        )}

        {/* 登录方式切换（仅在配置开启验证码登录时显示，默认关闭） */}
        {showSwitcher && (
          <div className="mb-6">
            <Segmented<LoginTab>
              block
              value={activeTab}
              onChange={(v) => setActiveTab(v)}
              options={[
                { label: "密码登录", value: "password" },
                { label: "验证码登录", value: "otp" },
              ]}
            />
          </div>
        )}

        {/* ---------- 验证码登录（B 阶段实现，当前为占位说明） ---------- */}
        {otpEnabled && activeTab === "otp" ? (
          <div className="space-y-4">
            <Alert
              type="info"
              showIcon
              icon={<ShieldCheck className="w-4 h-4" />}
              title="验证码登录将在下一阶段开放"
              description={
                <span className="text-xs leading-relaxed">
                  开关已在「系统设置 → 登录与账号」中开启，但发码与校验能力
                  属于 A-P1 阶段。当前请使用密码登录，或用管理员创建的账号登录。
                </span>
              }
            />
            <Button
              block
              type="text"
              className="text-muted-foreground"
              onClick={() => setActiveTab("password")}
            >
              返回密码登录
            </Button>
          </div>
        ) : (
          /* ---------- 密码登录（统一账号输入框） ---------- */
          <Form
            form={form}
            layout="vertical"
            onFinish={onFinish}
            autoComplete="off"
            size="large"
            requiredMark={false}
            initialValues={{ identifier: "", remember: false }}
          >
            <Form.Item
              name="identifier"
              label={
                <span className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">
                  账号
                </span>
              }
              extra={accountHint}
              rules={[
                { required: true, message: "请输入您的账号！" },
                {
                  // 仅做格式提醒；真正的权威判定在后端
                  validator: (_rule, value: string) => {
                    if (!value) return Promise.resolve();
                    if (!resolveIdentifier(value)) {
                      return Promise.reject(
                        new Error(
                          "请输入邮箱、手机号或用户名（用户名 3-20 位字母数字组合）"
                        )
                      );
                    }
                    // 配置关闭用户名登录时，提前给出明确提示，
                    // 而不是等后端返回「账号或密码错误」让用户困惑
                    const hit = resolveIdentifier(value);
                    if (
                      hit?.field === "username" &&
                      !config["auth.login.username"]
                    ) {
                      return Promise.reject(
                        new Error("系统已关闭用户名登录，请使用邮箱或手机号")
                      );
                    }
                    return Promise.resolve();
                  },
                },
              ]}
            >
              <Input
                prefix={accountIcon}
                placeholder="邮箱 / 手机号 / 用户名"
                className="hover:border-blue-500/50 focus:border-blue-500 transition-all"
              />
            </Form.Item>

            <Form.Item
              name="password"
              label={
                <span className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">
                  登录密码
                </span>
              }
              rules={[{ required: true, message: "请输入您的密码！" }]}
            >
              <Input.Password
                prefix={<Lock className="w-4 h-4 text-muted-foreground mr-2" />}
                placeholder="••••••••"
                className="hover:border-blue-500/50 focus:border-blue-500 transition-all"
              />
            </Form.Item>

            <div className="flex items-center justify-between mb-8">
              <Form.Item name="remember" valuePropName="checked" noStyle>
                <Checkbox className="text-sm text-muted-foreground transition-colors hover:text-foreground">
                  记住我
                </Checkbox>
              </Form.Item>
              <span
                className="text-sm text-muted-foreground cursor-not-allowed select-none opacity-60"
                title="找回密码将在下一阶段随验证码能力一起开放"
              >
                忘记密码？
              </span>
            </div>

            <Form.Item className="mb-0">
              <Button
                type="primary"
                htmlType="submit"
                block
                loading={loading}
                icon={<LogIn className="w-4 h-4" />}
                className="bg-blue-600 hover:bg-blue-500 border-none font-bold tracking-wide"
              >
                {loading ? "登录中..." : "立即登录"}
              </Button>
            </Form.Item>

            {/* 是否开放自助注册由配置控制 */}
            {config["auth.register.enabled"] && (
              <div className="mt-8 pt-6 border-t border-border text-center">
                <p className="text-muted-foreground text-sm">
                  还没有账号？{" "}
                  <Link
                    href="/register"
                    className="text-foreground hover:text-blue-500 transition-all inline-flex items-center font-semibold"
                  >
                    点击注册 <UserPlus className="ml-1.5 w-4 h-4" />
                  </Link>
                </p>
              </div>
            )}
          </Form>
        )}
      </Card>

      <div className="mt-8 text-center text-[11px] tracking-widest uppercase text-muted-foreground opacity-70">
        © 2026 CareerAI Technology
      </div>
    </AuthShell>
  );
};

const LoginPage = () => {
  return (
    <AuthThemeProvider>
      <LoginContent />
    </AuthThemeProvider>
  );
};

export default LoginPage;
