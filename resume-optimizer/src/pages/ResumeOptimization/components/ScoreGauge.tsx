/**
 * ScoreGauge —— 简历综合评分卡
 *
 * 【暗色适配】
 * - 背景渐变 rgba 不透明（暗色下会偏暗，已在 globals.css 内分别定义）
 * - 评分进度条环色 #3b82f6→#8b5cf6 在 dark 模式下替换为更柔和的 #60a5fa→#a78bfa
 * - 副文字 #888 / #555 / #52c41a 全部走 CSS 变量
 */

import React, { useEffect, useState } from "react";
import { Progress, Tag } from "antd";
import type { ResumeTag } from "../../../api";

interface Props {
  score: number;
  tags: ResumeTag[];
  highlights: string[];
}

const tagColorMap: Record<string, string> = {
  positive: "green",
  warning: "orange",
  negative: "red",
};

const ScoreGauge: React.FC<Props> = ({ score, tags, highlights }) => {
  // 读父级 html class → 决定进度环的渐变色
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    setIsDark(root.classList.contains("dark"));
    const obs = new MutationObserver(() => {
      setIsDark(root.classList.contains("dark"));
    });
    obs.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  const stroke = isDark
    ? { "0%": "#60a5fa", "100%": "#a78bfa" }
    : { "0%": "#3b82f6", "100%": "#8b5cf6" };

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
          percent={score}
          size={100}
          strokeColor={stroke}
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
            简历综合评分
          </h3>
          <p
            style={{
              margin: "0 0 12px",
              color: "var(--text-3)",
              fontSize: 13,
            }}
          >
            {score >= 80
              ? "优秀！您的简历竞争力很强"
              : score >= 60
              ? "良好，还有一些可提升的空间"
              : "建议根据下方建议进行全面优化"}
          </p>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {tags.map((t, i) => (
              <Tag key={i} color={tagColorMap[t.type] || "default"}>
                {t.label}
              </Tag>
            ))}
          </div>
        </div>
      </div>
      {highlights.length > 0 && (
        <div
          style={{
            marginTop: 16,
            borderTop: "1px solid var(--border-1)",
            paddingTop: 12,
          }}
        >
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--success)",
            }}
          >
            ✨ 亮点：
          </span>
          {highlights.map((h, i) => (
            <span
              key={i}
              style={{
                fontSize: 13,
                color: "var(--text-2)",
                marginLeft: 8,
              }}
            >
              {h}
              {i < highlights.length - 1 ? " · " : ""}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

export default ScoreGauge;
