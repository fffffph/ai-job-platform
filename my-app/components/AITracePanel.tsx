"use client";

/**
 * ============================================
 * AITracePanel —— AI 决策过程可视化面板
 * ============================================
 *
 * 【职责】
 * 把后端通过 SSE 推送的节点级 trace 事件（P1 起埋点）渲染成
 * 可折叠的时间轴，让用户直观看到 AI 的每一步：
 *   - 哪个节点执行了、花了多久
 *   - 节点输入/输出是什么（展开查看完整 JSON）
 *
 * 【学习导向价值】
 * 这是整个 AI 平台「可观测性」的落地点——Agent 不再是黑盒，
 * 每一步决策（调了什么工具、检索到什么、生成什么）都透明可见。
 *
 * 【主题适配】
 * 使用 Antd 组件 + CSS 变量，随主应用明暗主题自动切换。
 */

import React from "react";
import { Card, Timeline, Tag, Space, Typography, Collapse } from "antd";
import { ClockCircleOutlined } from "@ant-design/icons";
import type { TraceEvent } from "@/api";

const { Text } = Typography;

/** 节点名 → 中文展示名 */
const NODE_LABELS: Record<string, string> = {
  parse: "解析简历",
  analyze: "AI 结构化分析",
  match_assess: "岗位匹配度评估",
  suggest: "建议汇总",
  retrieve: "知识库检索",
  answer: "回答生成",
  generate: "回答生成",
  agent: "Agent 决策",
  tools: "工具执行",
};

/** 节点名 → 标签颜色 */
const NODE_COLORS: Record<string, string> = {
  agent: "blue",
  tools: "green",
  analyze: "purple",
  match_assess: "orange",
  retrieve: "cyan",
  answer: "blue",
  generate: "blue",
  parse: "default",
  suggest: "default",
};

/**
 * 根据耗时返回颜色（快/中/慢三档）。
 * <10ms 默认、<100ms 绿、<1000ms 橙、≥1000ms 红。
 */
function durationColor(ms: number): string {
  if (ms < 10) return "default";
  if (ms < 100) return "green";
  if (ms < 1000) return "orange";
  return "red";
}

/**
 * 从节点 output 中提取一句简短动作描述（尽力而为）。
 *
 * 【深度思考】若该节点确实思考过，输出里会带 reasoningMs（后端节点埋点写入），
 * 这里把「其中的思考耗时」缀在摘要后面，让用户看清慢在哪：
 * 是检索慢、工具慢，还是模型推理慢。
 */
function summarizeOutput(output: unknown): string {
  if (!output || typeof output !== "object") {
    return "";
  }
  const o = output as Record<string, unknown>;

  const base = summarizeAction(o);
  const reasoningMs = o.reasoningMs;

  if (typeof reasoningMs === "number" && reasoningMs > 0) {
    const thinking = `含思考 ${(reasoningMs / 1000).toFixed(1)}s`;
    return base ? `${base} · ${thinking}` : thinking;
  }

  return base;
}

/** 节点 output → 动作摘要（不含思考耗时，由 summarizeOutput 负责拼接） */
function summarizeAction(o: Record<string, unknown>): string {
  if (typeof o.action === "string") {
    if (o.action === "call_tools") {
      const calls = o.toolCalls as Array<{ name?: string }> | undefined;
      const names = (calls ?? []).map((c) => c.name).filter(Boolean);
      return names.length > 0 ? `调用工具：${names.join("、")}` : "调用工具";
    }
    if (o.action === "answer") {
      return "给出回答";
    }
  }
  if (typeof o.chunkCount === "number") {
    return `检索命中 ${o.chunkCount} 个片段`;
  }
  if (typeof o.resultCount === "number") {
    return `执行 ${o.resultCount} 个工具`;
  }
  if ("analysis" in o) {
    return "产出结构化分析";
  }
  if ("match" in o) {
    return "产出匹配度结果";
  }
  return "";
}

/**
 * 将 Date 格式化为 HH:mm:ss.SSS（毫秒精度）。
 * AI 各节点耗时经常只有几百毫秒，精确到毫秒才能看清节点间的衔接。
 */
function formatTime(d: Date): string {
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}

/**
 * 解析节点的执行时间窗口。
 * 后端 timestamp 在节点结束时记录，因此：
 *   开始时间 = timestamp - durationMs，结束时间 = timestamp。
 * 返回格式化后的文本；timestamp 缺失或非法时返回 null（不显示时间行）。
 */
function parseNodeTime(
  evt: TraceEvent
): { startText: string; endText: string; startDate: Date } | null {
  const end = new Date(evt.timestamp);
  if (Number.isNaN(end.getTime())) return null;
  const start = new Date(end.getTime() - evt.durationMs);
  return {
    startText: formatTime(start),
    endText: formatTime(end),
    startDate: start,
  };
}

interface Props {
  /** trace 事件列表（按发生顺序） */
  events: TraceEvent[];
}

const AITracePanel: React.FC<Props> = ({ events }) => {
  if (!events || events.length === 0) {
    return null;
  }

  const totalMs = events.reduce((sum, e) => sum + e.durationMs, 0);

  // 整个流程的起点时间 = 第一个节点的开始时间，
  // 后续节点用它计算「距开始 +Nms」的相对偏移
  const firstTime = events.length > 0 ? parseNodeTime(events[0]) : null;
  const baseStartMs = firstTime?.startDate.getTime();
  // 整个流程的终点时间 = 最后一个节点的结束时间（用于标题展示整体起止）
  const lastEndTime =
    events.length > 0 ? parseNodeTime(events[events.length - 1]) : null;

  return (
    <Card
      size="small"
      title={
        <span>
          🔍 AI 决策过程（{events.length} 步，总耗时 {totalMs}ms）
          {/* 有合法时间戳时，标题补充整体起止时钟，一眼看清这轮 AI 跑在哪个时间段 */}
          {firstTime && lastEndTime && (
            <Text
              type="secondary"
              style={{ fontSize: 12, marginLeft: 8, fontWeight: 400 }}
            >
              {firstTime.startText} ~ {lastEndTime.endText}
            </Text>
          )}
        </span>
      }
      style={{ borderRadius: 12, marginBottom: 16 }}
    >
      <Timeline
        items={events.map((evt, index) => {
          const label = NODE_LABELS[evt.nodeName] ?? evt.nodeName;
          const summary = summarizeOutput(evt.output);

          // 解析该节点的开始/结束时间与相对偏移（timestamp 非法时为 null，不显示）
          const timeInfo = parseNodeTime(evt);
          const offsetMs =
            timeInfo && baseStartMs !== undefined
              ? timeInfo.startDate.getTime() - baseStartMs
              : null;

          return {
            key: index,
            color: NODE_COLORS[evt.nodeName] ?? "blue",
            children: (
              <div>
                <Space size={8} wrap style={{ marginBottom: 4 }}>
                  <Tag color={NODE_COLORS[evt.nodeName] ?? "blue"}>
                    {label}
                  </Tag>
                  <Tag color={durationColor(evt.durationMs)}>
                    {evt.durationMs}ms
                  </Tag>
                  {summary && (
                    <Text type="secondary" style={{ fontSize: 13 }}>
                      {summary}
                    </Text>
                  )}
                </Space>

                {/* 时间节点行：显示「开始 → 结束」毫秒级时钟 + 距流程开始的相对偏移 */}
                {timeInfo && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      fontSize: 12,
                      color: "var(--muted-foreground, #888)",
                      marginBottom: 4,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    <ClockCircleOutlined />
                    <span>
                      {timeInfo.startText} → {timeInfo.endText}
                      {offsetMs !== null && (
                        <span style={{ marginLeft: 6 }}>
                          （距开始 +{offsetMs}ms）
                        </span>
                      )}
                    </span>
                  </div>
                )}

                <Collapse
                  ghost
                  size="small"
                  items={[
                    {
                      key: "detail",
                      label: (
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          查看输入 / 输出详情
                        </Text>
                      ),
                      children: (
                        <div
                          style={{
                            fontSize: 12,
                            lineHeight: 1.6,
                            color: "var(--muted-foreground, #888)",
                          }}
                        >
                          <div style={{ marginBottom: 8 }}>
                            <Text strong style={{ fontSize: 12 }}>
                              📥 输入
                            </Text>
                            <pre
                              style={{
                                whiteSpace: "pre-wrap",
                                wordBreak: "break-all",
                                margin: "4px 0 0",
                                background: "var(--bg-soft, #fafafa)",
                                padding: 8,
                                borderRadius: 6,
                                maxHeight: 200,
                                overflow: "auto",
                              }}
                            >
                              {JSON.stringify(evt.input, null, 2)}
                            </pre>
                          </div>
                          <div>
                            <Text strong style={{ fontSize: 12 }}>
                              📤 输出
                            </Text>
                            <pre
                              style={{
                                whiteSpace: "pre-wrap",
                                wordBreak: "break-all",
                                margin: "4px 0 0",
                                background: "var(--bg-soft, #fafafa)",
                                padding: 8,
                                borderRadius: 6,
                                maxHeight: 300,
                                overflow: "auto",
                              }}
                            >
                              {JSON.stringify(evt.output, null, 2)}
                            </pre>
                          </div>
                        </div>
                      ),
                    },
                  ]}
                />
              </div>
            ),
          };
        })}
      />

      <div
        style={{
          marginTop: 8,
          fontSize: 12,
          color: "var(--muted-foreground, #888)",
          display: "flex",
          alignItems: "center",
          gap: 4,
        }}
      >
        <ClockCircleOutlined />
        点击每个节点可展开查看该步骤的完整输入输出
      </div>
    </Card>
  );
};

export default AITracePanel;
