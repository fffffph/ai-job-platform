"use client";

/**
 * ============================================
 * HistoryPage —— AI 决策历史页面
 * ============================================
 *
 * 【职责】
 * 独立承载「AI 决策历史」面板，作为一级功能入口，
 * 让用户回看平台上每一次 AI 执行（简历分析 / 知识库问答 / 职位发现）
 * 的完整决策过程，呼应整个平台「学习导向 / 可观测」的定位。
 */

import React from "react";
import { motion } from "framer-motion";
import AITraceHistory from "@/components/AITraceHistory";

const HistoryPage: React.FC = () => {
  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.5 }}
      className="p-8"
      style={{ maxWidth: 1100, margin: "0 auto" }}
    >
      <h1 className="text-2xl font-bold text-foreground m-0 mb-2">AI 决策历史</h1>
      <p
        className="m-0 mb-8"
        style={{
          fontSize: 14,
          color: "var(--muted-foreground, #888)",
        }}
      >
        回看你每一次 AI 执行的决策过程——它为什么这么答、每一步花了多久、检索到了什么。
      </p>

      <AITraceHistory />
    </motion.div>
  );
};

export default HistoryPage;
