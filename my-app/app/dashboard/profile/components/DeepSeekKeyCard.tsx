/**
 * ============================================
 * DeepSeek API Key 设置卡片
 * ============================================
 *
 * 【功能】
 * 1. 展示密钥状态（未配置 / 已配置 + 脱敏尾号 + 更新时间）
 * 2. 密码型输入框（默认掩码，可切换显示/隐藏）
 * 3. 保存、删除/清空按钮
 * 4. 测试连通性按钮（不落库，实时验证 Key 是否有效）
 * 5. 获取步骤引导 + 官方入口提示 + 费用说明
 *
 * 【安全说明】
 * - 明文 Key 只存在于本卡片的输入框中，保存后由服务端加密存储
 * - 前端只能拿到脱敏尾号，永远看不到已保存的完整 Key
 *
 * 【暗色适配】
 *   - 卡片标题图标色 → CSS 变量 (accent-1)
 *   - 状态展示块背景 #fafafa → var(--bg-soft)
 *   - 边框与文字 → CSS 变量
 */

import React, { useEffect, useState } from "react";
import {
  Card,
  Input,
  Button,
  Space,
  Tag,
  Alert,
  Tooltip,
  Popconfirm,
  Typography,
  Divider,
  App,
} from "antd";
import {
  KeyOutlined,
  EyeInvisibleOutlined,
  EyeTwoTone,
  SaveOutlined,
  DeleteOutlined,
  ThunderboltOutlined,
  QuestionCircleOutlined,
  CheckCircleOutlined,
  LinkOutlined,
} from "@ant-design/icons";
import {
  getDeepSeekKeyStatus,
  saveDeepSeekKey,
  deleteDeepSeekKey,
  testDeepSeekKey,
  ERROR_MESSAGES,
} from "@/api";
import type { DeepSeekKeyStatus } from "@/api";

const { Text, Paragraph } = Typography;

const DEEPSEEK_PLATFORM_URL = "https://platform.deepseek.com/";

const DeepSeekKeyCard = () => {
  const { message: msg } = App.useApp();

  // ---------- 状态 ----------
  const [status, setStatus] = useState<DeepSeekKeyStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // ---------- 加载状态 ----------
  useEffect(() => {
    loadStatus();
  }, []);

  const loadStatus = async () => {
    setLoading(true);
    const res = await getDeepSeekKeyStatus();
    if (res.success) {
      setStatus(res.data);
    } else {
      const errorMsg = res.code
        ? ERROR_MESSAGES[res.code] || res.message
        : res.message;
      msg.error(errorMsg);
    }
    setLoading(false);
  };

  // ---------- 保存 ----------
  const handleSave = async () => {
    if (!apiKey.trim()) {
      msg.warning("请输入 DeepSeek API Key");
      return;
    }
    setSaving(true);
    const res = await saveDeepSeekKey(apiKey.trim());
    if (res.success) {
      setStatus(res.data);
      setApiKey("");
      msg.success("API Key 保存成功");
    } else {
      const errorMsg = res.code
        ? ERROR_MESSAGES[res.code] || res.message
        : res.message;
      msg.error(errorMsg);
    }
    setSaving(false);
  };

  // ---------- 删除 ----------
  const handleDelete = async () => {
    setDeleting(true);
    const res = await deleteDeepSeekKey();
    if (res.success) {
      setStatus({ configured: false, maskedTail: "", updatedAt: null });
      setApiKey("");
      msg.success("API Key 已删除");
    } else {
      const errorMsg = res.code
        ? ERROR_MESSAGES[res.code] || res.message
        : res.message;
      msg.error(errorMsg);
    }
    setDeleting(false);
  };

  // ---------- 测试连通性 ----------
  const handleTest = async () => {
    if (!apiKey.trim()) {
      msg.warning("请先输入要测试的 API Key");
      return;
    }
    setTesting(true);
    const res = await testDeepSeekKey(apiKey.trim());
    if (res.success) {
      if (res.data.ok) {
        msg.success("连接成功，API Key 有效");
      } else {
        msg.error(`测试失败：${res.data.message}`);
      }
    } else {
      const errorMsg = res.code
        ? ERROR_MESSAGES[res.code] || res.message
        : res.message;
      msg.error(errorMsg);
    }
    setTesting(false);
  };

  return (
    <Card
      title={
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <KeyOutlined style={{ color: "var(--accent-1)" }} />
          DeepSeek API Key
        </div>
      }
      style={{ borderRadius: "12px" }}
      extra={
        <Tooltip title="用于 AI 简历优化功能，费用由用户自行承担">
          <QuestionCircleOutlined style={{ color: "var(--text-3)" }} />
        </Tooltip>
      }
    >
      {/* ===== 状态展示 ===== */}
      <div
        style={{
          padding: "12px 16px",
          background: "var(--bg-soft)",
          border: "1px solid var(--border-1)",
          borderRadius: "8px",
          marginBottom: "16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "8px",
        }}
      >
        <Space size="small">
          <Text type="secondary">状态：</Text>
          {status?.configured ? (
            <Tag icon={<CheckCircleOutlined />} color="success">
              已配置
            </Tag>
          ) : (
            <Tag color="default">未配置</Tag>
          )}
          {status?.configured && (
            <>
              <Text type="secondary">尾号：</Text>
              <Text code>{status.maskedTail}</Text>
            </>
          )}
        </Space>

        {status?.configured && status.updatedAt && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            更新时间：
            {new Date(status.updatedAt).toLocaleString("zh-CN")}
          </Text>
        )}
      </div>

      {/* ===== 输入框 + 操作按钮 ===== */}
      <Space.Compact style={{ width: "100%", marginBottom: "12px" }}>
        <Input.Password
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={
            status?.configured
              ? "输入新的 API Key 以替换（留空则保持原值）"
              : "粘贴您的 DeepSeek API Key（以 sk- 开头）"
          }
          iconRender={(visible) =>
            visible ? <EyeTwoTone /> : <EyeInvisibleOutlined />
          }
          style={{ height: 40 }}
          autoComplete="off"
        />
      </Space.Compact>

      <Space wrap>
        <Button
          type="primary"
          icon={<SaveOutlined />}
          loading={saving}
          onClick={handleSave}
        >
          保存
        </Button>

        <Button
          icon={<ThunderboltOutlined />}
          loading={testing}
          onClick={handleTest}
        >
          测试连通性
        </Button>

        {status?.configured && (
          <Popconfirm
            title="确认删除 API Key？"
            description="删除后 AI 简历优化将无法使用，需重新配置。"
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={handleDelete}
          >
            <Button danger icon={<DeleteOutlined />} loading={deleting}>
              删除
            </Button>
          </Popconfirm>
        )}
      </Space>

      <Divider style={{ margin: "20px 0 16px" }} />

      {/* ===== 获取引导 ===== */}
      <Alert
        type="info"
        showIcon
        message="如何获取 DeepSeek API Key？"
        description={
          <div style={{ fontSize: 13 }}>
            <Paragraph style={{ marginBottom: "8px" }}>
              1. 前往 DeepSeek 开放平台注册并登录
            </Paragraph>
            <Paragraph style={{ marginBottom: "8px" }}>
              2. 在「API Keys」页面点击「创建 API Key」生成密钥
            </Paragraph>
            <Paragraph style={{ marginBottom: "8px" }}>
              3. 复制密钥（以 sk- 开头）粘贴到上方输入框，点击「保存」
            </Paragraph>
            <Paragraph style={{ marginBottom: "8px" }}>
              官方入口：
              <a
                href={DEEPSEEK_PLATFORM_URL}
                target="_blank"
                rel="noopener noreferrer"
                style={{ marginLeft: "4px" }}
              >
                {DEEPSEEK_PLATFORM_URL}
                <LinkOutlined style={{ marginLeft: "4px" }} />
              </a>
            </Paragraph>
            <Paragraph
              style={{
                marginBottom: 0,
                color: "var(--warning)",
              }}
            >
              ⚠️ 费用说明：调用 DeepSeek API 会产生费用，由您自行承担。请妥善保管您的
              Key，本平台加密存储，不会明文泄露。
            </Paragraph>
          </div>
        }
        style={{ borderRadius: "8px" }}
      />
    </Card>
  );
};

export default DeepSeekKeyCard;
