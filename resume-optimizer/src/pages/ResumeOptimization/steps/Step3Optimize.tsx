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
import MatchCard from "../components/MatchCard";
import ChatPanel from "../components/ChatPanel";
import ResumePreview from "../components/ResumePreview";
import VersionHistory from "../components/VersionHistory";
import ThinkingPanel from "../../../components/ThinkingPanel";
import type { ChatMessage, ResumeTag, MatchResult } from "../../../api";
import type { ResumeVersion } from "../../../hooks/useConversation";

interface Props {
  score: number;
  tags: ResumeTag[];
  highlights: string[];
  /** 岗位匹配度结果（null 表示未评估，不展示匹配度卡片） */
  matchResult: MatchResult | null;
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
  /** 当前这一轮的深度思考状态（对话修改中） */
  thinkingActive: boolean;
  thinkingContent: string;
  thinkingMs: number;
  /**
   * 首轮优化的思考过程快照。
   *
   * 单独传进来是因为 Step2 在优化完成后就卸载了 —— 若不快照一份，
   * 用户"分析时看得到、结束后就看不到"。
   */
  optimizeThinking: { content: string; ms: number };
}

const Step3Optimize: React.FC<Props> = ({
  score,
  tags,
  highlights,
  matchResult,
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
  thinkingActive,
  thinkingContent,
  thinkingMs,
  optimizeThinking,
}) => (
  <motion.div
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    style={{ display: "flex", flexDirection: "column", gap: 16 }}
  >
    {/* 顶部评分 */}
    <ScoreGauge score={score} tags={tags} highlights={highlights} />

    {/* 岗位匹配度（仅当填写了 JD 并评估成功时展示） */}
    <MatchCard match={matchResult} />

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
      {/* 首轮优化的思考过程：优化完成后 Step2 会卸载，这里保留一份可回看的快照，
          否则用户"分析时看得到、结束后就看不到" */}
      {optimizeThinking.content && (
        <ThinkingPanel
          active={false}
          content={optimizeThinking.content}
          elapsedMs={optimizeThinking.ms}
        />
      )}

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
          thinkingActive={thinkingActive}
          thinkingContent={thinkingContent}
          thinkingMs={thinkingMs}
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
