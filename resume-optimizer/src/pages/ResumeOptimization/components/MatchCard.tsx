/**
 * ============================================
 * MatchCard —— 岗位匹配度评估卡片
 * ============================================
 *
 * 【职责】
 * 展示简历与目标岗位的匹配度评估结果（P2 结构化输出）：
 * - 匹配度评分（0-100，按分数高低用绿/橙/红三档颜色）
 * - 已命中关键词（绿色标签）
 * - 缺失关键词（红色标签，提醒需要补充的能力）
 * - 差距分析（核心差距的文本描述）
 * - 改进计划（按优先级 high/medium/low 排序，配颜色标签）
 *
 * 【暗色适配】
 * 使用 CSS 变量（--text-1/--text-2/--text-3/--border-1/--gradient-soft），
 * 与 ScoreGauge 保持一致，明暗主题自动切换。
 */

import React from "react";
import { Progress, Tag, Divider } from "antd";
import type { MatchResult } from "../../../api";

interface Props {
  /** 匹配度结果（null 时不渲染，由父组件决定是否展示） */
  match: MatchResult | null;
}

/** 优先级 → 颜色映射 */
const priorityColorMap: Record<"high" | "medium" | "low", string> = {
  high: "red",
  medium: "orange",
  low: "blue",
};

/** 优先级 → 中文标签 */
const priorityLabelMap: Record<"high" | "medium" | "low", string> = {
  high: "高优先",
  medium: "中优先",
  low: "低优先",
};

/**
 * 根据匹配度分数返回进度环颜色。
 * ≥70 绿（匹配良好）、40-69 橙（有差距）、<40 红（差距较大）。
 */
function scoreColor(score: number): string {
  if (score >= 70) return "#52c41a";
  if (score >= 40) return "#fa8c16";
  return "#ff4d4f";
}

const MatchCard: React.FC<Props> = ({ match }) => {
  if (!match) {
    return null;
  }

  const color = scoreColor(match.matchScore);

  return (
    <div
      style={{
        background: "var(--gradient-soft)",
        borderRadius: 12,
        padding: "24px 20px",
        marginBottom: 16,
        border: "1px solid var(--border-1)",
      }}
    >
      {/* 顶部：匹配度评分 */}
      <div
        style={{
          display: "flex",
          gap: 20,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <Progress
          type="circle"
          percent={match.matchScore}
          size={100}
          strokeColor={color}
          format={(p) => (
            <span
              style={{
                fontSize: 28,
                fontWeight: 700,
                color: "var(--text-1)",
              }}
            >
              {p}
            </span>
          )}
        />
        <div style={{ flex: 1, minWidth: 200 }}>
          <h3
            style={{
              margin: "0 0 4px",
              fontSize: 18,
              fontWeight: 600,
              color: "var(--text-1)",
            }}
          >
            🎯 岗位匹配度
          </h3>
          <p
            style={{
              margin: 0,
              color: "var(--text-3)",
              fontSize: 13,
            }}
          >
            {match.matchScore >= 70
              ? "匹配度较高，可针对性突出相关经验"
              : match.matchScore >= 40
                ? "存在一定差距，建议按下方计划补强"
                : "差距较大，建议重点补充缺失的关键技能"}
          </p>
        </div>
      </div>

      <Divider style={{ margin: "16px 0" }} />

      {/* 命中关键词 */}
      {match.matchedKeywords.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--success)",
            }}
          >
            ✓ 已命中关键词：
          </span>
          {match.matchedKeywords.map((kw, i) => (
            <Tag key={i} color="green" style={{ marginLeft: 6 }}>
              {kw}
            </Tag>
          ))}
        </div>
      )}

      {/* 缺失关键词 */}
      {match.missingKeywords.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--danger)",
            }}
          >
            ✗ 缺失关键词：
          </span>
          {match.missingKeywords.map((kw, i) => (
            <Tag key={i} color="red" style={{ marginLeft: 6 }}>
              {kw}
            </Tag>
          ))}
        </div>
      )}

      {/* 差距分析 */}
      {match.gapAnalysis && (
        <p
          style={{
            fontSize: 13,
            color: "var(--text-2)",
            lineHeight: 1.7,
            margin: "0 0 12px",
          }}
        >
          <strong style={{ color: "var(--text-1)" }}>差距分析：</strong>
          {match.gapAnalysis}
        </p>
      )}

      {/* 改进计划 */}
      {match.improvementPlan.length > 0 && (
        <div>
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--text-1)",
              display: "block",
              marginBottom: 8,
            }}
          >
            📋 改进计划：
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {match.improvementPlan.map((plan, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                  fontSize: 13,
                  color: "var(--text-2)",
                }}
              >
                <Tag
                  color={priorityColorMap[plan.priority]}
                  style={{ marginRight: 0, flexShrink: 0 }}
                >
                  {priorityLabelMap[plan.priority]}
                </Tag>
                <span style={{ lineHeight: 1.6 }}>{plan.action}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default MatchCard;
