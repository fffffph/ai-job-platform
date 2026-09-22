/**
 * Step2Analyzing —— AI 分析中/错误页
 *
 * 【暗色适配】
 * - 错误提示框：背景与边框色改用 success/danger 变量（这里改 danger）
 * - 旋转动画环：跟随主题颜色（蓝色在深色下用更亮的蓝）
 * - 提示文字 "AI 正在分析..." → 改用次要文字色
 */

import React from "react";
import { Spin, Button } from "antd";
import { ArrowLeftOutlined, ReloadOutlined, KeyOutlined } from "@ant-design/icons";
import { motion } from "framer-motion";

interface Props {
  error?: string | null;
  /** 是否因未配置 API Key 被拦截（true 时显示"去配置"按钮） */
  needApiKey?: boolean;
  onBack?: () => void;
  onRetry?: () => void;
  /** 跳转到个人中心配置 API Key */
  onGoConfig?: () => void;
}

const Step2Analyzing: React.FC<Props> = ({
  error,
  needApiKey,
  onBack,
  onRetry,
  onGoConfig,
}) => {
  if (error) {
    return (
      <div style={{ textAlign: "center", padding: "64px 20px" }}>
        <p
          style={{
            color: "var(--danger)",
            fontSize: 14,
            marginBottom: 24,
            padding: 16,
            background: "var(--danger-bg)",
            border: "1px solid var(--danger-border)",
            borderRadius: 8,
            display: "inline-block",
            minWidth: 320,
          }}
        >
          {error}
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          {needApiKey && (
            <Button type="primary" icon={<KeyOutlined />} onClick={onGoConfig}>
              去个人中心配置 API Key
            </Button>
          )}
          <Button icon={<ArrowLeftOutlined />} onClick={onBack}>
            返回上一步
          </Button>
          <Button type="primary" icon={<ReloadOutlined />} onClick={onRetry}>
            重试
          </Button>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: 400,
      }}
    >
      {/* 脉冲动画环 */}
      <div style={{ position: "relative", width: 96, height: 96, marginBottom: 32 }}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            background: "rgba(96, 165, 250, 0.18)",
            animation: "ping 1.5s cubic-bezier(0,0,0.2,1) infinite",
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 8,
            borderRadius: "50%",
            border: "3px solid var(--accent-1)",
            borderTopColor: "transparent",
            animation: "spin 1s linear infinite",
          }}
        />
        <div style={{
          position: "absolute",
          inset: 20,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 30,
        }}>
          🤖
        </div>
      </div>
      <Spin
        spinning
        size="large"
        description={
          <span style={{ color: "var(--text-2)", fontSize: 16 }}>
            AI 正在分析您的简历...
          </span>
        }
      >
        <div style={{ padding: 48 }} />
      </Spin>

      <style>{`
        @keyframes ping {
          75%, 100% { transform: scale(1.5); opacity: 0; }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </motion.div>
  );
};

export default Step2Analyzing;
