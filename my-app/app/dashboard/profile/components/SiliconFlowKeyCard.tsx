/**
 * ============================================
 * SiliconFlow API Key 设置卡片
 * ============================================
 *
 * 【功能】
 * 1. 展示密钥状态（未配置 / 已配置 + 脱敏尾号 + 更新时间）
 * 2. 密码型输入框（默认掩码，可切换显示/隐藏）
 * 3. 保存、删除/清空按钮
 * 4. 测试连通性按钮（不落库，实时验证 Key 是否有效）
 * 5. 获取步骤引导 + 官方入口提示 + 费用说明
 *
 * 【用途】
 * SiliconFlow（硅基流动）提供 Embedding 向量化能力（bge-m3 模型），
 * 用于「工作台 · 个人知识库」的文档入库与语义检索。
 *
 * 【安全说明】
 * - 明文 Key 只存在于本卡片的输入框中，保存后由服务端加密存储
 * - 前端只能拿到脱敏尾号，永远看不到已保存的完整 Key
 *
 * 【暗色适配】
 * 参照 DeepSeekKeyCard，全部使用 CSS 变量，明暗主题自动切换。
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
  CloudOutlined,
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
  getSiliconFlowKeyStatus,
  saveSiliconFlowKey,
  deleteSiliconFlowKey,
  testSiliconFlowKey,
  ERROR_MESSAGES,
} from "@/api";
import type { SiliconFlowKeyStatus } from "@/api";

const { Text, Paragraph } = Typography;

/** 硅基流动官方平台地址 */
const SILICONFLOW_PLATFORM_URL = "https://siliconflow.cn/";

const SiliconFlowKeyCard = () => {
  const { message: msg } = App.useApp();

  // ---------- 状态 ----------
  const [status, setStatus] = useState<SiliconFlowKeyStatus | null>(null);
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
    const res = await getSiliconFlowKeyStatus();
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
      msg.warning("请输入 SiliconFlow API Key");
      return;
    }
    setSaving(true);
    const res = await saveSiliconFlowKey(apiKey.trim());
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
    const res = await deleteSiliconFlowKey();
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
    const res = await testSiliconFlowKey(apiKey.trim());
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
          <CloudOutlined style={{ color: "var(--accent-1)" }} />
          SiliconFlow API Key（Embedding）
        </div>
      }
      style={{ borderRadius: "12px" }}
      extra={
        <Tooltip title="用于知识库 RAG 的 Embedding 向量化，费用由用户自行承担">
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
              : "粘贴您的 SiliconFlow API Key（以 sk- 开头）"
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
            description="删除后知识库文档将无法向量化入库与检索，需重新配置。"
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
        message="如何获取 SiliconFlow API Key？"
        description={
          <div style={{ fontSize: 13 }}>
            <Paragraph style={{ marginBottom: "8px" }}>
              1. 前往硅基流动（SiliconFlow）官网注册并登录
            </Paragraph>
            <Paragraph style={{ marginBottom: "8px" }}>
              2. 进入「API 密钥」页面，点击「新建 API 密钥」生成密钥
            </Paragraph>
            <Paragraph style={{ marginBottom: "8px" }}>
              3. 复制密钥（以 sk- 开头）粘贴到上方输入框，点击「保存」
            </Paragraph>
            <Paragraph style={{ marginBottom: "8px" }}>
              官方入口：
              <a
                href={SILICONFLOW_PLATFORM_URL}
                target="_blank"
                rel="noopener noreferrer"
                style={{ marginLeft: "4px" }}
              >
                {SILICONFLOW_PLATFORM_URL}
                <LinkOutlined style={{ marginLeft: "4px" }} />
              </a>
            </Paragraph>
            <Paragraph
              style={{
                marginBottom: 0,
                color: "var(--warning)",
              }}
            >
              ⚠️ 说明：本 Key 用于知识库文档的 Embedding 向量化（bge-m3 模型）。
              新用户注册硅基流动有免费额度；超出部分费用由您自行承担。请妥善保管您的
              Key，本平台加密存储，不会明文泄露。
            </Paragraph>
          </div>
        }
        style={{ borderRadius: "8px" }}
      />
    </Card>
  );
};

export default SiliconFlowKeyCard;
