/**
 * ResumePreview —— 简历预览/导出组件
 *
 * 【职责】
 * 把 Markdown 简历渲染为格式良好的预览页面。
 * 既会被用于 Step3 的实时预览，也会被 Step4 配合
 * html2pdf 转为 PDF 下载使用。
 *
 * 【暗色适配策略】
 * 预览区是用户阅读/编辑简历的核心区域，必须满足：
 *   1. 暗色模式下使用合适的页面底色与文字色，而不是硬编码 #fff / #333
 *   2. 配色对比度至少达到 AA（≥ 4.5:1）
 *
 * PDF / Word / HTML 导出仍保持原始的白底黑字打印风格
 * （独立 `utils/export.ts` 内部样式，与本组件解耦）。
 */

import React from "react";

interface Props {
  resume: string;
  originalResume?: string;
  /** 可选：给外层容器设置 id，用于 PDF 导出时定位 DOM */
  containerId?: string;
}

// 简单 Markdown → JSX（支持标题、加粗、列表、换行）
function renderMarkdown(text: string): React.ReactNode {
  return text.split("\n").map((line, i) => {
    if (line.startsWith("## "))
      return (
        <h3
          key={i}
          style={{ margin: "14px 0 6px", fontSize: 16, color: "var(--text-1)" }}
        >
          {line.slice(3)}
        </h3>
      );
    if (line.startsWith("# "))
      return (
        <h2
          key={i}
          style={{
            margin: "16px 0 8px",
            fontSize: 18,
            color: "var(--text-1)",
            borderBottom: "1px solid var(--border-1)",
            paddingBottom: 6,
          }}
        >
          {line.slice(2)}
        </h2>
      );
    if (line.startsWith("- "))
      return (
        <li
          key={i}
          style={{
            marginLeft: 16,
            fontSize: 14,
            lineHeight: 1.8,
            color: "var(--text-1)",
          }}
        >
          {line.slice(2)}
        </li>
      );
    if (line.startsWith("**") && line.endsWith("**"))
      return (
        <p
          key={i}
          style={{
            fontWeight: 600,
            margin: "8px 0 4px",
            fontSize: 14,
            color: "var(--text-1)",
          }}
        >
          {line.slice(2, -2)}
        </p>
      );
    if (line.trim() === "") return <br key={i} />;
    return (
      <p
        key={i}
        style={{
          margin: "2px 0",
          fontSize: 14,
          lineHeight: 1.7,
          color: "var(--text-1)",
        }}
      >
        {line}
      </p>
    );
  });
}

/**
 * 简历预览组件
 *
 * 配色全部走 CSS 变量，确保明暗模式都能正常阅读。
 */
const ResumePreview: React.FC<Props> = ({ resume, containerId }) => (
  <div
    id={containerId}
    style={{
      background: "var(--bg-card)",
      borderRadius: 8,
      padding: "24px 28px",
      border: "1px solid var(--border-1)",
      boxShadow: "var(--shadow-card)",
      fontFamily: "system-ui, sans-serif",
      fontSize: 14,
      lineHeight: 1.8,
      color: "var(--text-1)",
      maxHeight: "calc(100vh - 200px)",
      overflowY: "auto",
    }}
  >
    {renderMarkdown(resume)}
  </div>
);

export default ResumePreview;
