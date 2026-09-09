/**
 * Step1Input —— 输入/上传简历
 *
 * 【暗色适配】
 * - InboxOutlined 默认 accent 色 → 跟随 antd ConfigProvider colorPrimary
 *   （已是 #3b82f6，dark 变体里 antd 自动加亮）
 * - 副文案灰色 #999 → var(--text-3)
 * - "开始 AI 优化"按钮用渐变（明暗都好看），暗色下加 stop 透明度
 */

import React from "react";
import { Upload, Input, Button, Tabs, Card, Divider } from "antd";
import { InboxOutlined, RocketOutlined } from "@ant-design/icons";
import { motion } from "framer-motion";

const { Dragger } = Upload;
const { TextArea } = Input;

interface Props {
  file: File | null;
  resumeText: string;
  onUpload: (file: File) => void;
  onTextInput: (text: string) => void;
  onOptimize: () => void;
}

const Step1Input: React.FC<Props> = ({
  file,
  resumeText,
  onUpload,
  onTextInput,
  onOptimize,
}) => {
  const hasContent = !!file || !!resumeText.trim();

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      style={{ maxWidth: 800, margin: "0 auto" }}
    >
      <Card style={{ borderRadius: 12 }}>
        <Tabs
          defaultActiveKey="upload"
          items={[
            {
              key: "upload",
              label: "上传简历文件",
              children: (
                <Dragger
                  accept=".pdf,.docx,.txt"
                  multiple={false}
                  beforeUpload={() => false}
                  onChange={(info) => {
                    const f = info.fileList[0]?.originFileObj;
                    if (f) onUpload(f);
                  }}
                  style={{ padding: "40px 0" }}
                >
                  <p className="ant-upload-drag-icon">
                    <InboxOutlined style={{ fontSize: 48, color: "var(--accent-1)" }} />
                  </p>
                  <p style={{ fontSize: 16, fontWeight: 500, color: "var(--text-1)" }}>
                    点击或拖拽文件到此区域
                  </p>
                  <p style={{ color: "var(--text-3)", fontSize: 13 }}>
                    支持 PDF、DOCX、TXT，最大 10MB
                  </p>
                </Dragger>
              ),
            },
            {
              key: "text",
              label: "粘贴简历文本",
              children: (
                <TextArea
                  rows={14}
                  placeholder="在此粘贴您的简历文本内容..."
                  value={resumeText}
                  onChange={(e) => onTextInput(e.target.value)}
                />
              ),
            },
          ]}
        />
        <Divider />
        <Button
          type="primary"
          block
          size="large"
          disabled={!hasContent}
          icon={<RocketOutlined />}
          style={{
            height: 48,
            borderRadius: 8,
            // 用户模式下亮色更柔和；明暗模式下都看
            background: hasContent
              ? "var(--gradient-cta, linear-gradient(135deg, #3b82f6, #8b5cf6))"
              : undefined,
            border: "none",
          }}
          onClick={onOptimize}
        >
          开始 AI 优化
        </Button>
      </Card>
    </motion.div>
  );
};

export default Step1Input;
