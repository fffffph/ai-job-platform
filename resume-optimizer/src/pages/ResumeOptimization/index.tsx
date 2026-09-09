/**
 * ResumeOptimization — 简历优化主页面
 *
 * 4 步向导：
 * ① 上传/输入 → ② AI 分析 → ③ 对话式迭代 → ④ 导出
 */

import React from "react";
import { Steps, App } from "antd";
import { motion } from "framer-motion";
import Step1Input from "./steps/Step1Input";
import Step2Analyzing from "./steps/Step2Analyzing";
import Step3Optimize from "./steps/Step3Optimize";
import Step4Export from "./steps/Step4Export";
import { useConversation } from "../../hooks/useConversation";

const STEP_ITEMS = [
  { title: "输入简历" },
  { title: "AI 分析" },
  { title: "对话优化" },
  { title: "导出" },
];

const ResumeOptimizationPage: React.FC = () => {
  const { message } = App.useApp();
  const conv = useConversation();

  const hasResume = () => {
    if (!conv.file && !conv.resumeText.trim()) {
      message.warning("请先上传简历文件或粘贴简历文本");
      return false;
    }
    return true;
  };

  return (
    <div style={{ padding: "24px 48px", minHeight: "100vh" }}>
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        style={{ maxWidth: 1400, margin: "0 auto" }}
      >
        {/* 步进器 */}
        <Steps
          current={conv.step - 1}
          items={STEP_ITEMS}
          style={{ marginBottom: 32 }}
          size="small"
        />

        {/* 步骤内容 */}
        {conv.step === 1 && (
          <Step1Input
            file={conv.file}
            resumeText={conv.resumeText}
            onUpload={conv.handleFileUpload}
            onTextInput={conv.handleTextInput}
            onOptimize={() => {
              if (hasResume()) conv.startOptimize();
            }}
          />
        )}

        {conv.step === 2 && (
          <Step2Analyzing
            error={conv.error}
            needApiKey={conv.needApiKey}
            onBack={() => {
              conv.reset();
              conv.goToStep(1);
            }}
            onRetry={() => {
              conv.startOptimize();
            }}
            onGoConfig={() => {
              // 子应用嵌入主应用（qiankun）时同源，直接跳主应用的个人中心页
              window.location.href = "/dashboard/profile";
            }}
          />
        )}

        {conv.step === 3 && (
          <Step3Optimize
            score={conv.score}
            tags={conv.tags}
            highlights={conv.highlights}
            currentResume={conv.currentResume}
            originalResume={conv.versions[0]?.resume || ""}
            versions={conv.versions}
            currentVersionIndex={conv.currentVersionIndex}
            messages={conv.messages}
            changes={conv.changes}
            isStreaming={conv.isStreaming}
            onSend={conv.sendMessage}
            onRollback={conv.rollback}
            onBack={() => conv.goToStep(1)}
            onNextStep={() => conv.goToStep(4)}
          />
        )}

        {conv.step === 4 && (
          <Step4Export
            resume={conv.currentResume}
            onReset={conv.reset}
            onBack={() => conv.goToStep(3)}
          />
        )}
      </motion.div>
    </div>
  );
};

export default ResumeOptimizationPage;
