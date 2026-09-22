/**
 * ChatPanel —— 对话式输入面板
 *
 * 【暗色适配】
 * - 用户消息气泡：保留品牌渐变（蓝→紫），不变（品牌色跨明暗都用）
 * - AI 消息气泡：背景从 #f5f5f5 → var(--bg-soft)，文字 var(--text-1)
 * - "AI 正在思考"提示色 → var(--text-3)
 */

import React, { useState, useRef, useEffect } from "react";
import { Input, Button, Tag } from "antd";
import { SendOutlined } from "@ant-design/icons";
import type { ChatMessage } from "../../../api";

interface Props {
  messages: ChatMessage[];
  isStreaming: boolean;
  onSend: (text: string) => void;
}

const QUICK_ACTIONS = ["精简内容", "更多量化数据", "更专业表达", "优化关键词"];

const ChatPanel: React.FC<Props> = ({ messages, isStreaming, onSend }) => {
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = () => {
    if (!input.trim() || isStreaming) return;
    onSend(input.trim());
    setInput("");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* 消息列表 */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "12px 0",
          maxHeight: "calc(100vh - 320px)",
        }}
      >
        {messages.map((m, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              justifyContent: m.role === "user" ? "flex-end" : "flex-start",
              marginBottom: 12,
            }}
          >
            <div
              style={{
                maxWidth: "85%",
                padding: "10px 14px",
                borderRadius: 12,
                fontSize: 13,
                lineHeight: 1.6,
                // 用户消息：品牌渐变（明暗下都好看）；AI 消息：跟随主题的柔和底
                background:
                  m.role === "user"
                    ? "linear-gradient(135deg, #3b82f6, #8b5cf6)"
                    : "var(--bg-soft)",
                color:
                  m.role === "user"
                    ? "var(--text-on-accent)"
                    : "var(--text-1)",
                border: m.role === "user" ? "none" : "1px solid var(--border-1)",
              }}
            >
              {m.content}
            </div>
          </div>
        ))}
        {isStreaming && (
          <div
            style={{
              color: "var(--text-3)",
              fontSize: 13,
              padding: "8px 14px",
            }}
          >
            AI 正在思考...
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* 快捷指令 */}
      <div
        style={{
          display: "flex",
          gap: 6,
          marginBottom: 8,
          flexWrap: "wrap",
        }}
      >
        {QUICK_ACTIONS.map((action) => (
          <Tag
            key={action}
            className="quick-action-tag"
            style={{ cursor: "pointer", fontSize: 12 }}
            onClick={() => onSend(action)}
          >
            {action}
          </Tag>
        ))}
      </div>

      {/*
        快捷指令 Tag 的显式配色（修复日间模式黑底不可读问题）
        ============================================================
        【根因】Antd 6 的 Tag 默认样式（浅灰底 + 深字 + 边框）通过
        cssinjs 的 :where(.css-xxx) 低特异性选择器注入；qiankun 的
        experimentalStyleIsolation 改写样式规则后这类选择器失效，
        导致无 color 属性的裸 Tag 失去默认配色、被环境样式污染成黑底。

        【修复】不再依赖 antd 默认 token，显式用 CSS 变量配色，
        日间（浅底深字）与夜间（深底浅字）自动切换，!important
        确保 cover 掉任何污染规则。
      */}
      <style>{`
        .quick-action-tag {
          background: var(--bg-soft) !important;
          color: var(--text-2) !important;
          border: 1px solid var(--border-1) !important;
          border-radius: 6px;
          user-select: none;
        }
        .quick-action-tag:hover {
          background: var(--accent-1) !important;
          color: var(--text-on-accent) !important;
          border-color: var(--accent-1) !important;
        }
      `}</style>

      {/* 输入框 */}
      <div style={{ display: "flex", gap: 8 }}>
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onPressEnter={handleSend}
          placeholder="描述你想怎么修改简历..."
          disabled={isStreaming}
          style={{ borderRadius: 8 }}
        />
        <Button
          type="primary"
          icon={<SendOutlined />}
          onClick={handleSend}
          loading={isStreaming}
          style={{ borderRadius: 8 }}
        />
      </div>
    </div>
  );
};

export default ChatPanel;
