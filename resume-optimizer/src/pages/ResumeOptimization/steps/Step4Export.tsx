/**
 * Step4Export —— 导出简历
 *
 * 【暗色适配】
 * - 副文字 `#888` 改 var(--text-3)
 */

import React, { useState } from "react";
import { Card, Button, message, Space } from "antd";
import { ReloadOutlined, DownloadOutlined } from "@ant-design/icons";
import { motion } from "framer-motion";
import ResumePreview from "../components/ResumePreview";
import { exportAsHtml, exportAsWord, exportAsPdf } from "../../../utils/export";

interface Props {
  resume: string;
  onReset: () => void;
  onBack: () => void;
}

const RESUME_PREVIEW_ID = "resume-export-preview";

const EXPORT_FORMATS = [
  { name: "PDF", ext: ".pdf", icon: "📄", desc: "适合打印和正式投递" },
  { name: "Word", ext: ".docx", icon: "📝", desc: "适合继续编辑修改" },
  { name: "HTML", ext: ".html", icon: "🌐", desc: "适合在线分享链接" },
];

const Step4Export: React.FC<Props> = ({ resume, onReset, onBack }) => {
  const [downloading, setDownloading] = useState<string | null>(null);

  const handleExport = async (format: string) => {
    setDownloading(format);
    try {
      switch (format) {
        case "PDF":
          await exportAsPdf(RESUME_PREVIEW_ID);
          break;
        case "Word":
          await exportAsWord(resume);
          break;
        case "HTML":
          exportAsHtml(resume);
          break;
      }
      message.success(`${format} 已下载`);
    } catch (err: any) {
      console.error(`[export] ${format} 失败:`, err);
      message.error(`${format} 导出失败: ${err?.message || "未知错误"}`);
    } finally {
      setDownloading(null);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      style={{ maxWidth: 900, margin: "0 auto" }}
    >
      <Card
        title="导出简历"
        style={{ borderRadius: 12 }}
        extra={
          <Space>
            <Button onClick={onBack}>返回修改</Button>
            <Button icon={<ReloadOutlined />} onClick={onReset}>
              重新开始
            </Button>
          </Space>
        }
      >
        {/* 导出选项 */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 16,
            marginBottom: 24,
          }}
          className="export-grid"
        >
          {EXPORT_FORMATS.map((f) => (
            <Card
              key={f.name}
              hoverable
              style={{ borderRadius: 8, textAlign: "center", cursor: "pointer" }}
              styles={{ body: { padding: "20px 12px" } }}
              onClick={() => handleExport(f.name)}
            >
              <div style={{ fontSize: 32, marginBottom: 8 }}>{f.icon}</div>
              <div
                style={{
                  fontSize: 16,
                  fontWeight: 600,
                  marginBottom: 4,
                  color: "var(--text-1)",
                }}
              >
                {f.name} 格式
              </div>
              <div style={{ fontSize: 12, color: "var(--text-3)" }}>{f.desc}</div>
              <Button
                type="primary"
                icon={<DownloadOutlined />}
                size="small"
                loading={downloading === f.name}
                style={{ marginTop: 12 }}
                onClick={(e) => {
                  e.stopPropagation();
                  handleExport(f.name);
                }}
              >
                {downloading === f.name ? "导出中..." : `下载 ${f.name}`}
              </Button>
            </Card>
          ))}
        </div>

        {/* 预览 */}
        <ResumePreview resume={resume} containerId={RESUME_PREVIEW_ID} />
      </Card>

      <style>{`
        @media (max-width: 640px) {
          .export-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </motion.div>
  );
};

export default Step4Export;
