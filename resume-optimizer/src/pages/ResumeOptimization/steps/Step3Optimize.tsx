/**
 * Step3Optimize —— 对话优化页
 *
 * 【暗色适配】
 * - "版本历史" 副文字 `#888` → var(--text-3)
 * - 评分卡的渐变背景 → 沿用 ScoreGauge 内部定义
 */

import React from "react";
import { Card, Button } from "antd";
import { ArrowLeftOutlined, DownloadOutlined } from "@ant-design/icons";
import { motion } from "framer-motion";
import ScoreGauge from "../components/ScoreGauge";
import ChatPanel from "../components/ChatPanel";
import ResumePreview from "../components/ResumePreview";
import VersionHistory from "../components/VersionHistory";
import type { ChatMessage, ResumeTag } from "../../../api";
import type { ResumeVersion } from "../../../hooks/useConversation";

interface Props {
  score: number;
  tags: ResumeTag[];
  highlights: string[];
  currentResume: string;
  originalResume: string;
  versions: ResumeVersion[];
  currentVersionIndex: number;
  messages: ChatMessage[];
  changes: any[];
  isStreaming: boolean;
  onSend: (text: string) => void;
  onRollback: (index: number) => void;
  onBack: () => void;
  onNextStep: () => void;
}

const Step3Optimize: React.FC<Props> = ({
  score,
  tags,
  highlights,
  currentResume,
  originalResume,
  versions,
  currentVersionIndex,
  messages,
  isStreaming,
  onSend,
  onRollback,
  onBack,
  onNextStep,
}) => (
  <motion.div
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    style={{ display: "flex", flexDirection: "column", gap: 16 }}
  >
    {/* 顶部评分 */}
    <ScoreGauge score={score} tags={tags} highlights={highlights} />

    {/* 版本历史 */}
    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <Button icon={<ArrowLeftOutlined />} size="small" onClick={onBack}>
        返回修改
      </Button>
      <span style={{ fontSize: 13, color: "var(--text-3)" }}>版本历史：</span>
      <VersionHistory
        versions={versions}
        currentIndex={currentVersionIndex}
        onSelect={onRollback}
      />
      <div style={{ flex: 1 }} />
      <Button
        type="primary"
        icon={<DownloadOutlined />}
        size="small"
        onClick={onNextStep}
      >
        导出简历
      </Button>
    </div>

    {/* 左右两栏：对话在左（更符合用户输入习惯） */}
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "360px 1fr",
        gap: 16,
      }}
      className="step3-layout"
    >
      {/* 左栏：对话面板 */}
      <Card
        title="💬 对话修改"
        style={{ borderRadius: 12 }}
        styles={{ body: { padding: 16, height: "calc(100% - 56px)" } }}
      >
        <ChatPanel
          messages={messages}
          isStreaming={isStreaming}
          onSend={onSend}
        />
      </Card>

      {/* 右栏：简历预览 */}
      <Card
        title="优化简历"
        style={{ borderRadius: 12 }}
        styles={{ body: { padding: 0 } }}
      >
        <ResumePreview resume={currentResume} originalResume={originalResume} />
      </Card>
    </div>

    <style>{`
      @media (max-width: 900px) {
        .step3-layout { grid-template-columns: 1fr !important; }
      }
    `}</style>
  </motion.div>
);

export default Step3Optimize;
