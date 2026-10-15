"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Form, Input, Button, Card, App, Alert } from "antd";
import { Mail, Lock, User, UserPlus, LogIn } from "lucide-react";
import Link from "next/link";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { registerApi, setToken, ERROR_MESSAGES, getPublicConfigsApi } from "@/api";
import type { PublicConfigMap } from "@/api";
import { validateUsername, USERNAME_HINT } from "@/lib/identifier";
import { AuthThemeProvider, AuthShell } from "@/components/auth/AuthShell";

/**
 * 注册页 —— 调用后端 /api/auth/register 接口真实注册
 *
 * 【改造要点（A-P0）】
 * 1. 「用户名」现在是**真正的登录账号**（写入 User.username），
 *    不再是昵称。历史版本把这个输入框映射给了 name，导致系统里
 *    其实没有「账号密码登录」能力——这是本次修复的核心。
 * 2. 密码最小长度取自公开配置 auth.password.min_length，与后端同一口径，
 *    避免前端放行 6 位、后端拒绝 8 位这种「提交了才报错」的体验割裂。
 * 3. 是否开放自助注册由 auth.register.enabled 控制，关闭时直接提示并引导回登录页。
 *
 * 【改造要点（主题跟随）】
 * 与登录页 / 强制改密页统一：背景、卡片、文字全部走 CSS 变量，
 * antd 算法随 next-themes 切换，不再写死暗色。
 */

/** 公开配置读取失败时的兜底默认值 */
const CONFIG_FALLBACK = {
  registerEnabled: true,
  minLength: 8,
} as const;

const RegisterContent = () => {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  /** 密码最小长度（来自服务端公开配置，与后端校验同源） */
  const [minLength, setMinLength] = useState<number>(CONFIG_FALLBACK.minLength);
  /** 是否开放自助注册 */
  const [registerEnabled, setRegisterEnabled] = useState<boolean>(
    CONFIG_FALLBACK.registerEnabled
  );

  // 读取公开配置（免登录接口），让前端校验规则与后端一致
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await getPublicConfigsApi();
      if (cancelled || !res.success || !res.data) return;
      const data = res.data as PublicConfigMap;
      if (typeof data["auth.password.min_length"] === "number") {
        setMinLength(data["auth.password.min_length"]);
      }
      if (typeof data["auth.register.enabled"] === "boolean") {
        setRegisterEnabled(data["auth.register.enabled"]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** 密码规则的动态提示文案 */
  const passwordHint = useMemo(
    () => `至少 ${minLength} 位，且需同时包含字母和数字`,
    [minLength]
  );

  /**
   * 表单提交处理
   *
   * 流程：
   * 1. 设置 loading 状态
   * 2. 调用 registerApi 发起 POST /api/auth/register
   *    - username → 登录账号（唯一，3-20 位字母数字下划线，禁止纯数字）
   *    - name     → 昵称（这里默认与用户名一致，用户可后续在个人中心修改，
   *                 避免新账号没有展示名）
   * 3. 成功 → 存 Token → 跳转 Dashboard
   * 4. 失败 → 显示错误信息
   */
  const onFinish = async (values: {
    username: string;
    email?: string;
    password: string;
  }) => {
    setLoading(true);

    const res = await registerApi({
      // 邮箱改为选填：填了才传，空串归一为 undefined（后端视为未填写）
      email: values.email?.trim() || undefined,
      password: values.password,
      // 登录账号
      username: values.username.trim(),
      // 昵称默认取用户名，保证侧边栏/头像处有可读的展示名
      name: values.username.trim(),
    });

    if (res.success) {
      setToken(res.data.token);
      message.success("注册成功！欢迎加入 CareerAI");
      router.push("/dashboard");
    } else {
      const msg =
        res.code ? ERROR_MESSAGES[res.code] || res.message : res.message;
      message.error(msg);
    }

    setLoading(false);
  };

  return (
    <AuthShell maxWidth={440}>
      <Card className="auth-card" styles={{ body: { padding: "2.5rem 2rem" } }}>
        <div className="text-center mb-10">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2 }}
          >
            <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-b from-foreground to-foreground/60 bg-clip-text text-transparent mb-2">
              创建新账号
            </h1>
            <p className="text-muted-foreground text-sm font-medium">
              加入 AI 驱动的求职新时代
            </p>
          </motion.div>
        </div>

        {/* 自助注册被管理员关闭时，直接给出明确指引，而不是让用户填完再被拒 */}
        {!registerEnabled ? (
          <div className="space-y-6">
            <Alert
              type="warning"
              showIcon
              title="当前未开放自助注册"
              description={
                <span className="text-xs leading-relaxed">
                  管理员已在「系统设置 → 登录与账号」中关闭自助注册。
                  请联系管理员在「用户管理 → 新增用户」中为您创建账号。
                </span>
              }
            />
            <Link href="/login" className="block">
              <Button block icon={<LogIn className="w-4 h-4" />}>
                返回登录
              </Button>
            </Link>
          </div>
        ) : (
          <Form
            form={form}
            layout="vertical"
            onFinish={onFinish}
            autoComplete="off"
            size="large"
            requiredMark={false}
          >
            <Form.Item
              name="username"
              label={
                <span className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">
                  用户名（登录账号）
                </span>
              }
              extra={
                <span className="text-[11px] text-muted-foreground leading-relaxed">
                  将作为登录账号，{USERNAME_HINT}
                </span>
              }
              rules={[
                {
                  required: true,
                  message: "请输入您的用户名！",
                },
                {
                  // 复用 lib/identifier.ts 的校验，与后端规则同源
                  validator: (_rule, value: string) => {
                    const err = validateUsername(value);
                    return err ? Promise.reject(new Error(err)) : Promise.resolve();
                  },
                },
              ]}
            >
              <Input
                prefix={<User className="w-4 h-4 text-muted-foreground mr-2" />}
                placeholder="如 zhangsan"
                className="hover:border-blue-500/50 focus:border-blue-500 transition-all"
              />
            </Form.Item>

            <Form.Item
              name="email"
              label={
                <span className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">
                  邮箱地址（选填）
                </span>
              }
              extra={
                <span className="text-[11px] text-muted-foreground leading-relaxed">
                  选填；可用于找回密码，也可后续在个人中心补充
                </span>
              }
              rules={[
                // 邮箱不再强制：仅当填写时才校验格式（用户名已是必填登录标识）
                { type: "email", message: "请输入有效的邮箱地址！" },
              ]}
            >
              <Input
                prefix={<Mail className="w-4 h-4 text-muted-foreground mr-2" />}
                placeholder="name@example.com"
                className="hover:border-blue-500/50 focus:border-blue-500 transition-all"
              />
            </Form.Item>

            <Form.Item
              name="password"
              label={
                <span className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">
                  设置密码
                </span>
              }
              extra={
                <span className="text-[11px] text-muted-foreground leading-relaxed">
                  {passwordHint}
                </span>
              }
              rules={[
                { required: true, message: "请设置您的密码！" },
                {
                  min: minLength,
                  message: `密码长度不能少于 ${minLength} 位！`,
                },
                {
                  // 复杂度与后端 assertPasswordStrength 保持一致
                  validator: (_rule, value: string) => {
                    if (!value) return Promise.resolve();
                    if (!/[a-zA-Z]/.test(value) || !/\d/.test(value)) {
                      return Promise.reject(
                        new Error("密码需同时包含字母和数字！")
                      );
                    }
                    return Promise.resolve();
                  },
                },
              ]}
            >
              <Input.Password
                prefix={<Lock className="w-4 h-4 text-muted-foreground mr-2" />}
                placeholder="••••••••"
                className="hover:border-blue-500/50 focus:border-blue-500 transition-all"
              />
            </Form.Item>

            <Form.Item
              name="confirm"
              label={
                <span className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">
                  确认密码
                </span>
              }
              dependencies={["password"]}
              rules={[
                { required: true, message: "请再次输入密码以确认！" },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    if (!value || getFieldValue("password") === value) {
                      return Promise.resolve();
                    }
                    return Promise.reject(new Error("两次输入的密码不一致！"));
                  },
                }),
              ]}
            >
              <Input.Password
                prefix={<Lock className="w-4 h-4 text-muted-foreground mr-2" />}
                placeholder="••••••••"
                className="hover:border-blue-500/50 focus:border-blue-500 transition-all"
              />
            </Form.Item>

            <Form.Item className="mt-8 mb-0">
              <Button
                type="primary"
                htmlType="submit"
                block
                loading={loading}
                icon={<UserPlus className="w-4 h-4" />}
                className="bg-blue-600 hover:bg-blue-500 border-none font-bold tracking-wide"
              >
                {loading ? "注册中..." : "立即注册"}
              </Button>
            </Form.Item>

            <div className="mt-8 pt-6 border-t border-border text-center">
              <p className="text-muted-foreground text-sm">
                已有账号？{" "}
                <Link
                  href="/login"
                  className="text-foreground hover:text-blue-500 transition-all inline-flex items-center font-semibold"
                >
                  返回登录 <LogIn className="ml-1.5 w-4 h-4" />
                </Link>
              </p>
            </div>
          </Form>
        )}
      </Card>

      <div className="mt-8 text-center text-[11px] tracking-widest uppercase text-muted-foreground opacity-70">
        © 2026 CareerAI Technology
      </div>
    </AuthShell>
  );
};

const RegisterPage = () => {
  return (
    <AuthThemeProvider>
      <RegisterContent />
    </AuthThemeProvider>
  );
};

export default RegisterPage;
