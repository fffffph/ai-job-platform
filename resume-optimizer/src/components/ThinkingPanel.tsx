/**
 * ============================================
 * ThinkingPanel —— 深度思考过程（流式逐字）面板
 * ============================================
 *
 * 【与主应用同名组件的差异】
 * 主应用那份展示的是「一次性到达的整段思考」（后端按节点粒度下发）；
 * 这一份是**逐字流式**：思考文本边生成边到达，因此思考期间就要把内容
 * 渲染出来并自动滚到底部，而不是等结果。
 *
 * 【三态】
 * 1. 思考中  ：转圈 + 实时计时 + 流式文本（自动滚动，末尾光标闪烁）
 * 2. 思考完成：显示「已深度思考 N 秒」，自动折叠
 * 3. 用户展开：回看完整思考过程
 *
 * 【计时器为什么在前端】
 * 服务端在思考阶段只能推 reasoning 增量，没有一个"总耗时"信号；
 * 本地计时器负责让用户"看得到它在动"，避免误以为卡死。
 */

import React, { useEffect, useRef, useState } from "react";
import { LoadingOutlined, BulbOutlined, DownOutlined, RightOutlined } from "@ant-design/icons";

interface Props {
  /** 是否正在思考（本轮优化进行中） */
  active: boolean;
  /** 已到达的思考过程全文（增量累积后的结果） */
  content: string;
  /** 完成后展示的耗时（毫秒）；不传则用面板自测的时长 */
  elapsedMs?: number;
}

/** 毫秒 → 「8.4 秒」 */
function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} 秒`;
}

const ThinkingPanel: React.FC<Props> = ({ active, content, elapsedMs }) => {
  /** 是否展开全文（默认折叠：答案才是主角） */
  const [expanded, setExpanded] = useState(false);
  /** 本地累计思考时长（仅 active 期间增长） */
  const [selfElapsedMs, setSelfElapsedMs] = useState(0);
  const startedAtRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!active) return;

    startedAtRef.current = Date.now();
    const timer = window.setInterval(() => {
      setSelfElapsedMs(Date.now() - startedAtRef.current);
    }, 100);

    return () => window.clearInterval(timer);
  }, [active]);

  // 思考中：内容增长时把滚动条钉在底部，形成"正在往下写"的观感。
  // 这是纯 DOM 副作用（不 setState），不会引发级联渲染。
  useEffect(() => {
    if (!active) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [content, active]);

  const shownMs = elapsedMs && elapsedMs > 0 ? elapsedMs : selfElapsedMs;
  const hasContent = content.length > 0;
  // 思考中强制可见（这就是流式的意义）；结束后默认折叠
  const bodyVisible = active ? hasContent : expanded && hasContent;

  return (
    <div
      style={{
        width: "100%",
        maxWidth: 560,
        marginTop: 24,
        background: "var(--bg-2)",
        border: "1px solid var(--border-1)",
        borderRadius: 10,
        padding: "10px 14px",
        fontSize: 13,
        textAlign: "left",
      }}
    >
      <div
        onClick={() => {
          // 思考中不允许折叠，避免用户把正在滚动的过程关掉
          if (!active && hasContent) setExpanded((v) => !v);
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          cursor: !active && hasContent ? "pointer" : "default",
          userSelect: "none",
        }}
      >
        {active ? <LoadingOutlined /> : <BulbOutlined />}
        <span style={{ color: "var(--text-2)" }}>
          {active ? "正在深度思考…" : "已深度思考"}
        </span>
        {!active && <span style={{ color: "var(--text-2)" }}>{formatSeconds(shownMs)}</span>}

        {active ? (
          <span
            style={{
              marginLeft: "auto",
              color: "var(--text-3)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {formatSeconds(selfElapsedMs)}
          </span>
        ) : (
          hasContent && (
            <span
              style={{
                marginLeft: "auto",
                color: "var(--text-3)",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              {expanded ? <DownOutlined /> : <RightOutlined />}
              {expanded ? "收起" : "展开思考过程"}
            </span>
          )
        )}
      </div>

      {/* 思考中的说明：此时还没有文本可看时给个交代 */}
      {active && !hasContent && (
        <div style={{ marginTop: 6, color: "var(--text-3)", fontSize: 12, lineHeight: 1.6 }}>
          模型正在推理，思考过程会逐字出现在这里。
        </div>
      )}

      {bodyVisible && (
        <div
          ref={scrollRef}
          style={{
            marginTop: 8,
            paddingTop: 8,
            borderTop: "1px dashed var(--border-1)",
            color: "var(--text-2)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            lineHeight: 1.75,
            fontSize: 12,
            maxHeight: 220,
            overflowY: "auto",
            textAlign: "left",
          }}
        >
          {content}
          {active && <span style={{ opacity: 0.6 }}>▍</span>}
        </div>
      )}
    </div>
  );
};

export default ThinkingPanel;
