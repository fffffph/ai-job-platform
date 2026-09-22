/**
 * ============================================
 * 简历导出工具
 * ============================================
 *
 * 支持三种格式：
 * - HTML   直接下载 .html（样式美观，可直接打开/分享）
 * - Word   使用 docx 库生成 .docx（适合再编辑）
 * - PDF    使用 html2pdf.js 将预览 DOM 转 PDF（所见即所得）
 */

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
} from "docx";

// ========== 类型 ==========

interface ExportFormat {
  name: string;
  ext: string;
  icon: string;
}

export const EXPORT_FORMATS: ExportFormat[] = [
  { name: "PDF", ext: ".pdf", icon: "📄" },
  { name: "Word", ext: ".docx", icon: "📝" },
  { name: "HTML", ext: ".html", icon: "🌐" },
];

// ========== 通用下载 ==========

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ========== 1) HTML 导出 ==========

/**
 * 将 Markdown 简历转为美观的 HTML 页面
 */
export function exportAsHtml(resumeText: string): void {
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>优化简历 - CareerAI</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC',
        'Microsoft YaHei', 'Noto Sans SC', sans-serif;
      background: #f5f5f5; padding: 40px 20px; color: #333;
    }
    .resume {
      max-width: 800px; margin: 0 auto; background: #fff;
      padding: 60px 80px; border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
    }
    h1 { font-size: 28px; margin: 20px 0 8px; color: #1a1a1a; }
    h2 { font-size: 20px; margin: 28px 0 12px; color: #333;
      border-bottom: 1px solid #e8e8e8; padding-bottom: 6px; }
    h3 { font-size: 16px; margin: 16px 0 8px; color: #555; }
    p { font-size: 14px; line-height: 1.8; margin: 4px 0; }
    li { font-size: 14px; line-height: 1.8; margin-left: 20px; margin: 2px 0; }
    strong { font-weight: 600; color: #222; }
    .badge {
      display: inline-block; background: #e6f7ff; color: #1890ff;
      padding: 2px 10px; border-radius: 12px; font-size: 12px; margin: 2px;
    }
    hr { border: none; border-top: 1px solid #eee; margin: 24px 0; }
  </style>
</head>
<body>
  <div class="resume">
    ${markdownToHtml(resumeText)}
  </div>
</body>
</html>`;

  downloadBlob(new Blob([html], { type: "text/html;charset=utf-8" }), `resume-${Date.now()}.html`);
}

// ========== 2) Word 导出 ==========

/**
 * 将 Markdown 简历转为 Word 文档（.docx）
 * 用简单的 Markdown 解析规则生成 docx 段落
 */
export async function exportAsWord(resumeText: string): Promise<void> {
  const paragraphs: Paragraph[] = [];

  const lines = resumeText.split("\n");

  for (const line of lines) {
    // 一级标题 # xxx
    if (line.startsWith("# ")) {
      paragraphs.push(
        new Paragraph({
          text: line.slice(2),
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 300, after: 150 },
          alignment: AlignmentType.LEFT,
        })
      );
    }
    // 二级标题 ## xxx
    else if (line.startsWith("## ")) {
      paragraphs.push(
        new Paragraph({
          text: line.slice(3),
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 250, after: 120 },
        })
      );
    }
    // 三级标题 ### xxx
    else if (line.startsWith("### ")) {
      paragraphs.push(
        new Paragraph({
          text: line.slice(4),
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 200, after: 100 },
        })
      );
    }
    // 列表项 - xxx 或 * xxx
    else if (line.match(/^\s*[-*]\s/)) {
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({ text: "• ", size: 24 }),
            new TextRun({ text: line.replace(/^\s*[-*]\s+/, ""), size: 24 }),
          ],
          spacing: { before: 40, after: 40 },
          indent: { left: 480 },
        })
      );
    }
    // 粗体行 **xxx**
    else if (line.trim().startsWith("**") && line.trim().endsWith("**")) {
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({
              text: line.trim().slice(2, -2),
              bold: true,
              size: 24,
            }),
          ],
          spacing: { before: 120, after: 80 },
        })
      );
    }
    // 空行
    else if (line.trim() === "") {
      paragraphs.push(new Paragraph({ spacing: { before: 100 } }));
    }
    // 普通段落
    else {
      paragraphs.push(
        new Paragraph({
          children: [new TextRun({ text: line, size: 24 })],
          spacing: { before: 40, after: 40 },
        })
      );
    }
  }

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: paragraphs,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  downloadBlob(blob, `resume-${Date.now()}.docx`);
}

// ========== 3) PDF 导出 ==========

/**
 * 将预览区域（DOM 元素）转为 PDF 下载
 *
 * html2pdf.js 底层是 html2canvas + jsPDF：
 * html2canvas 将 DOM 转图片 → jsPDF 创建 PDF 文件
 */
export async function exportAsPdf(elementId: string): Promise<void> {
  // 动态 import 避免首次加载过大
  const html2pdf = (await import("html2pdf.js")).default;

  const element = document.getElementById(elementId);
  if (!element) {
    throw new Error(`找不到导出元素 #${elementId}`);
  }

  const opt = {
    margin: [10, 10, 10, 10] as [number, number, number, number],
    filename: `resume-${Date.now()}.pdf`,
    image: { type: "jpeg" as const, quality: 0.95 },
    html2canvas: { scale: 2, useCORS: true },
    jsPDF: { unit: "mm", format: "a4", orientation: "portrait" as const },
  };

  await html2pdf().set(opt).from(element).save();
}

// ========== Markdown → HTML 辅助 ==========

function markdownToHtml(md: string): string {
  return md
    .split("\n")
    .map((line) => {
      if (line.startsWith("# ")) return `<h1>${escapeHtml(line.slice(2))}</h1>`;
      if (line.startsWith("## ")) return `<h2>${escapeHtml(line.slice(3))}</h2>`;
      if (line.startsWith("### ")) return `<h3>${escapeHtml(line.slice(4))}</h3>`;
      if (line.match(/^\s*[-*]\s/)) {
        return `<li>${escapeHtml(line.replace(/^\s*[-*]\s+/, ""))}</li>`;
      }
      if (line.trim() === "") return "";
      // 处理行内粗体
      let html = escapeHtml(line);
      html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
      return `<p>${html}</p>`;
    })
    .join("\n");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
