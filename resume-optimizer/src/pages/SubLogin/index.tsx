/**
 * ============================================
 * SubLogin —— 子应用独立登录页
 * ============================================
 *
 * 【使用场景】
 * 仅在子应用独立运行（非 qiankun 模式）且未登录时显示。
 * 用户在此页面输入邮箱和密码，调用后端 /api/auth/login 登录，
 * 成功后通过 onLoginSuccess 回调将 Token 存入 Context。
 *
 * 【设计原则】
 * - 不依赖主应用的任何组件或主题
 * - 使用 Ant Design 组件（子应用已有 antd 依赖）
 * - 简洁 — 只有邮箱 + 密码 + 登录按钮
 */

import React, { useState } from "react";
import { Form, Input, Button, Card, App } from "antd";
import { MailOutlined, LockOutlined } from "@ant-design/icons";

interface SubLoginProps {
  /** 登录成功回调，接收 JWT Token */
  onLoginSuccess: (token: string) => void;
}

/**
 * 子应用独立登录组件
 */
const SubLogin: React.FC<SubLoginProps> = ({ onLoginSuccess }) => {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();

  /**
   * 表单提交
   *
   * 调用后端 /api/auth/login（通过 Vite proxy 转发到主应用 Express 后端 :4000），
   * 成功后通过 onLoginSuccess 将 token 传给 AuthContext。
   */
  const handleSubmit = async (values: { email: string; password: string }) => {
    setLoading(true);

    try {
      // 调用后端登录接口（Vite proxy 会将 /api/* 转发到主应用）
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: values.email,
          password: values.password,
        }),
      });

      const data = await res.json();

      if (data.success) {
        // 登录成功 → 存入 Context → AuthGuard 自动放行
        onLoginSuccess(data.data.token);
        message.success(`登录成功，欢迎 ${data.data.user.name || values.email}`);
      } else {
        message.error(data.message || "登录失败，请检查邮箱和密码");
      }
    } catch {
      message.error("网络异常，请检查后端服务是否启动（端口 4000）");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
      }}
    >
      <Card
        style={{
          width: "400px",
          borderRadius: "16px",
          boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
        }}
        bodyStyle={{ padding: "48px 40px" }}
      >
        {/* Logo / 标题 */}
        <div style={{ textAlign: "center", marginBottom: "32px" }}>
          <h1 style={{ fontSize: "24px", fontWeight: 700, margin: "0 0 8px" }}>
            AI 简历优化
          </h1>
          <p style={{ color: "#999", fontSize: "14px", margin: 0 }}>
            登录以使用简历优化功能
          </p>
        </div>

        {/* 登录表单 */}
        <Form form={form} layout="vertical" onFinish={handleSubmit} size="large">
          <Form.Item
            name="email"
            rules={[
              { required: true, message: "请输入邮箱" },
              { type: "email", message: "邮箱格式不正确" },
            ]}
          >
            <Input
              prefix={<MailOutlined />}
              placeholder="邮箱地址"
            />
          </Form.Item>

          <Form.Item
            name="password"
            rules={[{ required: true, message: "请输入密码" }]}
          >
            <Input.Password
              prefix={<LockOutlined />}
              placeholder="密码"
            />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0 }}>
            <Button
              type="primary"
              htmlType="submit"
              block
              loading={loading}
              style={{ height: "44px", borderRadius: "8px", fontSize: "16px" }}
            >
              {loading ? "登录中..." : "登 录"}
            </Button>
          </Form.Item>
        </Form>

        <div
          style={{
            textAlign: "center",
            marginTop: "24px",
            color: "#bbb",
            fontSize: "12px",
          }}
        >
          独立调试模式 — 登录账号需已在主应用中注册
        </div>
      </Card>
    </div>
  );
};

export default SubLogin;
