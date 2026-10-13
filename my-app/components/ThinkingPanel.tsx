"use client";

/**
 * ============================================
 * ThinkingPanel —— 模型「深度思考」过程展示面板
 * ============================================
 *
 * 【职责】
 * 把 DeepSeek 思考模式（Thinking Mode）产出的推理过程渲染成可折叠面板，
 * 让「AI 在思考」这件事对用户可见：思考时实时计时，思考完展示耗时并可展开全文。
 *
 * 【为什么支持多段】
 * 职位发现的 ReAct 循环里 agent 会执行多轮，每轮各有一段思考；
 * 知识库问答 / 简历分析则通常只有一段。统一用数组承载，调用方不必区分场景。
 *
 * 【为什么计时器要放在前端？】
 * 后端要等模型把整段思考 + 回答全部生成完，才能拿到 reasoning_content；
 * 也就是说思考期间服务端没有任何进度可推。如果不做本地计时，
 * 用户面对的就是一个静止的转圈——会被当成"卡死了"。
 * 因此：本地计时器负责"让它看起来在动"，后端返回的真实耗时负责"最终定格"。
 *
 * 【三态】
 * 1. 思考中  ：转圈 + 本地计时，此时还没有思考文本可看（后端尚未返回）；
 * 2. 思考完成：显示「已深度思考 N 秒」，默认折叠；
 * 3. 用户展开：灰色小字展示思考全文（多段时按节点分段）。
 *
 * 【与 AITracePanel 的分工】
 * AITracePanel 展示的是「节点级」执行过程（检索命中什么、每步耗时多少），
 * 本组件展示的是「模型内部」的推理链，两者互补，互不替代。
 */

import React, { useEffect, useRef, useState } from "react";
import {
  LoadingOutlined,
  BulbOutlined,
  DownOutlined,
  RightOutlined,
} from "@ant-design/icons";
import type { ReasoningEntry } from "@/api";

/** 节点名 → 中文展示名（多段思考时的分段标题） */
const NODE_LABELS: Record<string, string> = {
  agent: "搜索决策",
  finalize: "推荐生成",
  generate: "回答生成",
  analyze: "简历分析",
  match_assess: "匹配度评估",
};

interface Props {
  /** 是否正在思考（本次请求开启思考且结果尚未返回） */
  active: boolean;
  /** 已到达的思考过程（可能多段，按到达顺序） */
  entries: ReasoningEntry[];
}

/** 毫秒 → 「8.4 秒」 */
function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} 秒`;
}

const ThinkingPanel: React.FC<Props> = ({ active, entries }) => {
  /** 是否展开思考全文（默认折叠：答案才是主角，思考是补充信息） */
  const [expanded, setExpanded] = useState(false);
  /** 本地累计思考时长（仅 active 期间增长） */
  const [elapsedMs, setElapsedMs] = useState(0);
  /** 本轮思考的起点，用于计算 elapsedMs */
  const startedAtRef = useRef(0);

  // 思考进行中：每 100ms 刷新一次计时；思考结束（active 变 false）时自动停表。
  // 依赖只有 active，避免 entries 到达时把计时器重置。
  //
  // 这里不在 effect 体内同步 setElapsedMs(0)：一是 React 官方不建议
  // （会引发级联渲染），二是没必要——父组件每次提问都会重置思考状态，
  // 本组件随之重新挂载，elapsedMs 自然从 0 开始；
  // 首个 tick 在 100ms 后按新的起点重算，误差可忽略。
  useEffect(() => {
    if (!active) return;

    startedAtRef.current = Date.now();

    const timer = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAtRef.current);
    }, 100);

    return () => window.clearInterval(timer);
  }, [active]);

  const hasContent = entries.length > 0;
  // 多段时展示合计耗时；单段时就是该段耗时
  const totalMs = entries.reduce((sum, e) => sum + (e.reasoningMs || 0), 0);

  return (
    <div
      style={{
        background: "var(--bg-soft, #fafafa)",
        border: "1px solid var(--border, #e8e8e8)",
        borderRadius: 8,
        padding: "10px 14px",
        fontSize: 13,
      }}
    >
      {/* ---------- 头部：状态 + 耗时 + 展开开关 ---------- */}
      <div
        onClick={() => {
          if (hasContent) setExpanded((v) => !v);
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          cursor: hasContent ? "pointer" : "default",
          userSelect: "none",
        }}
      >
        {active ? <LoadingOutlined /> : <BulbOutlined />}

        <span style={{ color: "var(--text-secondary, #666)" }}>
          {active ? "正在深度思考…" : "已深度思考"}
        </span>

        {!active && hasContent && (
          <span style={{ color: "var(--text-secondary, #666)" }}>
            {formatSeconds(totalMs)}
            {entries.length > 1 ? `（${entries.length} 段）` : ""}
          </span>
        )}

        {/* 思考中在右侧显示滚动的计时，让用户直观感到"它在动" */}
        {active && (
          <span
            style={{
              marginLeft: "auto",
              color: "var(--text-secondary, #666)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {formatSeconds(elapsedMs)}
          </span>
        )}

        {hasContent && (
          <span
            style={{
              marginLeft: active ? 8 : "auto",
              color: "var(--text-secondary, #666)",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            {expanded ? <DownOutlined /> : <RightOutlined />}
            {expanded ? "收起" : "展开思考过程"}
          </span>
        )}
      </div>

      {/* ---------- 思考中的说明：解释为什么现在看不到内容 ---------- */}
      {active && (
        <div
          style={{
            marginTop: 6,
            color: "var(--text-secondary, #999)",
            fontSize: 12,
            lineHeight: 1.6,
          }}
        >
          模型正在推理，思考过程将在每一步完成后返回。
        </div>
      )}

      {/* ---------- 思考全文（多段时按节点分段） ---------- */}
      {expanded && hasContent && (
        <div
          style={{
            marginTop: 8,
            paddingTop: 8,
            borderTop: "1px dashed var(--border, #e8e8e8)",
            maxHeight: 320,
            overflowY: "auto",
          }}
        >
          {entries.map((entry, index) => (
            <div
              key={index}
              style={{
                marginTop: index === 0 ? 0 : 12,
                color: "var(--text-secondary, #666)",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                lineHeight: 1.7,
                fontSize: 12,
              }}
            >
              {/* 多段时才显示分段标题，单段保持干净 */}
              {entries.length > 1 && (
                <div style={{ fontWeight: 600, marginBottom: 4 }}>
                  {index + 1}.{" "}
                  {NODE_LABELS[entry.nodeName ?? ""] ?? entry.nodeName ?? "思考"}
                  {entry.reasoningMs > 0
                    ? `（${formatSeconds(entry.reasoningMs)}）`
                    : ""}
                </div>
              )}
              {entry.content}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ThinkingPanel;
