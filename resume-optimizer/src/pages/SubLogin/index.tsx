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
 *
 * 【暗色适配】
 * - 整页渐变背景保留品牌色（蓝→紫），明暗都用同一个：跨明暗和谐自然
 * - 卡片背景跟随主题（浅色半透明白 / 深色半透明深蓝）
 * - 副标题色 #999 / #bbb 改 CSS 变量
 */

import React, { useState } from "react";
import { Form, Input, Button, Card, App } from "antd";
import { MailOutlined, LockOutlined } from "@ant-design/icons";

interface SubLoginProps {
  onLoginSuccess: (token: string) => void;
}

const SubLogin: React.FC<SubLoginProps> = ({ onLoginSuccess }) => {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();

  const handleSubmit = async (values: { email: string; password: string }) => {
    setLoading(true);
    try {
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
        // 整页：品牌渐变背景，明暗都用同一个（跨模式都和谐）
        background:
          "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
      }}
    >
      <Card
        style={{
          width: "400px",
          borderRadius: "16px",
          // 卡片采用 CSS 变量：浅色半透明白 / 深色半透明深蓝
          background: "var(--bg-card)",
          color: "var(--text-1)",
          boxShadow: "var(--shadow-modal)",
        }}
        styles={{ body: { padding: "48px 40px" } }}
      >
        <div style={{ textAlign: "center", marginBottom: "32px" }}>
          <h1
            style={{
              fontSize: "24px",
              fontWeight: 700,
              margin: "0 0 8px",
              color: "var(--text-1)",
            }}
          >
            AI 简历优化
          </h1>
          <p style={{ color: "var(--text-3)", fontSize: "14px", margin: 0 }}>
            登录以使用简历优化功能
          </p>
        </div>

        <Form form={form} layout="vertical" onFinish={handleSubmit} size="large">
          <Form.Item
            name="email"
            rules={[
              { required: true, message: "请输入邮箱" },
              { type: "email", message: "邮箱格式不正确" },
            ]}
          >
            <Input prefix={<MailOutlined />} placeholder="邮箱地址" />
          </Form.Item>

          <Form.Item
            name="password"
            rules={[{ required: true, message: "请输入密码" }]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="密码" />
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
            color: "var(--text-3)",
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
