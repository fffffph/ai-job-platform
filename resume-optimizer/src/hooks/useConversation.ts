/**
 * ============================================
 * useConversation — 简历对话式优化 Hook
 * ============================================
 *
 * 【职责】
 * 管理简历优化的完整对话流程：首轮优化 → 多轮迭代 → 版本回退 → 导出
 *
 * 【使用方式】
 * const {
 *   step, currentResume, versions, messages, isStreaming,
 *   startOptimize, sendMessage, rollback, goToStep
 * } = useConversation();
 */

import { useState, useCallback, useRef } from "react";
import {
  optimizeResumeApi,
  chatResumeApi,
  parseResumeApi,
  getDeepSeekKeyStatusApi,
} from "../api";
import type {
  OptimizeResult,
  ChatResult,
  ChatMessage,
  ResumeSuggestion,
  ResumeTag,
  ChangeItem,
  SectionContext,
} from "../api";

// ========== 类型定义 ==========

export interface ResumeVersion {
  id: string;
  index: number;
  resume: string;
  changes: ChangeItem[];
  label: string;
  timestamp: number;
}

export type Step = 1 | 2 | 3 | 4;

interface ConversationState {
  step: Step;
  file: File | null;
  resumeText: string;
  wordCount: number;
  score: number;
  tags: ResumeTag[];
  highlights: string[];
  suggestions: ResumeSuggestion[];
  currentResume: string;
  versions: ResumeVersion[];
  currentVersionIndex: number;
  messages: ChatMessage[];
  changes: ChangeItem[];
  isOptimizing: boolean;
  isStreaming: boolean;
  error: string | null;
  /** 是否因未配置 DeepSeek API Key 而被拦截（用于展示"去配置"入口） */
  needApiKey: boolean;
}

// ========== Hook ==========

export function useConversation() {
  const [state, setState] = useState<ConversationState>({
    step: 1,
    file: null,
    resumeText: "",
    wordCount: 0,
    score: 0,
    tags: [],
    highlights: [],
    suggestions: [],
    currentResume: "",
    versions: [],
    currentVersionIndex: -1,
    messages: [],
    changes: [],
    isOptimizing: false,
    isStreaming: false,
    error: null,
    needApiKey: false,
  });

  // ========== 步骤导航 ==========

  const goToStep = useCallback((step: Step) => {
    setState((s) => ({ ...s, step }));
  }, []);

  // ========== 步骤 1：上传/输入 ==========

  const handleFileUpload = useCallback((file: File) => {
    setState((s) => ({ ...s, file, resumeText: "", wordCount: 0 }));
  }, []);

  const handleTextInput = useCallback((text: string) => {
    setState((s) => ({
      ...s,
      resumeText: text,
      wordCount: text.trim().split(/\s+/).length,
    }));
  }, []);

  // ========== 步骤 2：解析 + 首轮优化 ==========

  // 跟踪当前请求的 AbortController，用户返回/重试时取消挂起的请求
  const abortRef = useRef<AbortController | null>(null);

  const startOptimize = useCallback(async () => {
    const { file, resumeText } = state;
    if (!file && !resumeText.trim()) return;

    // 取消上一次挂起的请求
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState((s) => ({ ...s, step: 2, isOptimizing: true, error: null, needApiKey: false }));

    try {
      // 入口拦截：未配置 DeepSeek API Key 时不发起 AI 请求，直接提示并引导配置
      const keyRes = await getDeepSeekKeyStatusApi();
      if (controller.signal.aborted) return;
      if (keyRes.success && keyRes.data && !keyRes.data.configured) {
        setState((s) => ({
          ...s,
          error: "需先在个人中心配置 DeepSeek API Key 才能使用 AI 简历优化",
          needApiKey: true,
          isOptimizing: false,
        }));
        return;
      }

      let textToOptimize = resumeText;

      // 有文件且无文本 → 先解析
      if (file && !resumeText.trim()) {
        const parseRes = await parseResumeApi(file);
        if (controller.signal.aborted) return; // 已被取消，不更新状态
        if (!parseRes.success) {
          setState((s) => ({
            ...s,
            error: parseRes.message,
            isOptimizing: false,
          }));
          return;
        }
        textToOptimize = parseRes.data.text;
        setState((s) => ({
          ...s,
          resumeText: parseRes.data.text,
          wordCount: parseRes.data.wordCount,
        }));
      }

      // 调用 AI 优化
      const optRes = await optimizeResumeApi({ text: textToOptimize });
      if (controller.signal.aborted) return;
      if (!optRes.success) {
        setState((s) => ({
          ...s,
          error: optRes.message,
          // 后端兜底拦截：未配置 Key 时置 needApiKey，引导去配置
          needApiKey: optRes.code === "DEEPSEEK_KEY_NOT_CONFIGURED",
          isOptimizing: false,
        }));
        return;
      }

      const data: OptimizeResult = optRes.data;
      const v0: ResumeVersion = {
        id: "v0",
        index: 0,
        resume: textToOptimize,
        changes: [],
        label: "原始版本",
        timestamp: Date.now(),
      };
      const v1: ResumeVersion = {
        id: "v1",
        index: 1,
        resume: data.optimized,
        changes: [],
        label: "首轮优化",
        timestamp: Date.now(),
      };

      setState((s) => ({
        ...s,
        step: 3,
        score: data.score,
        tags: data.tags,
        highlights: data.highlights,
        suggestions: data.suggestions,
        currentResume: data.optimized,
        versions: [v0, v1],
        currentVersionIndex: 1,
        messages: [
          {
            role: "assistant",
            content: `优化完成！综合评分 ${data.score} 分。你可以继续跟我对话来调整具体的段落——只要告诉我想改哪里、怎么改就行。`,
          },
        ],
        changes: [],
        isOptimizing: false,
      }));
    } catch (err: any) {
      // 静默错误（用户取消/导航离开）不显示给用户
      if (err?.code === "CANCELLED" || err?.silent) return;
      setState((s) => ({
        ...s,
        error: err?.message || "优化失败",
        isOptimizing: false,
      }));
    }
  }, [state.file, state.resumeText]);

  // ========== 步骤 3：对话式迭代 ==========

  const sendMessage = useCallback(
    async (text: string, sectionContext?: SectionContext) => {
      if (!text.trim() || !state.currentResume) return;

      const userMsg: ChatMessage = { role: "user", content: text };
      setState((s) => ({
        ...s,
        messages: [...s.messages, userMsg],
        isStreaming: true,
      }));

      try {
        const res = await chatResumeApi({
          resume: state.currentResume,
          message: text,
          history: state.messages,
          context: sectionContext,
        });

        if (!res.success) {
          setState((s) => ({
            ...s,
            isStreaming: false,
            error: res.message,
            needApiKey: res.code === "DEEPSEEK_KEY_NOT_CONFIGURED",
          }));
          return;
        }

        const data: ChatResult = res.data;
        const newVersion: ResumeVersion = {
          id: `v${state.versions.length}`,
          index: state.versions.length,
          resume: data.optimized,
          changes: data.changes,
          label: `第 ${state.versions.length} 轮修改`,
          timestamp: Date.now(),
        };

        const assistantMsg: ChatMessage = {
          role: "assistant",
          content: data.reply || "已修改",
        };

        setState((s) => ({
          ...s,
          currentResume: data.optimized,
          versions: [...s.versions, newVersion],
          currentVersionIndex: state.versions.length,
          messages: [...s.messages, assistantMsg],
          changes: data.changes,
          isStreaming: false,
        }));
      } catch (err: any) {
        setState((s) => ({
          ...s,
          isStreaming: false,
          error: err?.message || "对话请求失败",
        }));
      }
    },
    [state.currentResume, state.messages, state.versions]
  );

  // ========== 版本回退 ==========

  const rollback = useCallback(
    (versionIndex: number) => {
      const version = state.versions[versionIndex];
      if (!version) return;
      setState((s) => ({
        ...s,
        currentResume: version.resume,
        currentVersionIndex: versionIndex,
        messages: [
          ...s.messages,
          {
            role: "assistant",
            content: `已回退到「${version.label}」`,
          },
        ],
      }));
    },
    [state.versions]
  );

  // ========== 重置 ==========

  const reset = useCallback(() => {
    // 取消挂起的请求
    abortRef.current?.abort();
    abortRef.current = null;

    setState({
      step: 1,
      file: null,
      resumeText: "",
      wordCount: 0,
      score: 0,
      tags: [],
      highlights: [],
      suggestions: [],
      currentResume: "",
      versions: [],
      currentVersionIndex: -1,
      messages: [],
      changes: [],
      isOptimizing: false,
      isStreaming: false,
      error: null,
      needApiKey: false,
    });
  }, []);

  return {
    ...state,
    goToStep,
    handleFileUpload,
    handleTextInput,
    startOptimize,
    sendMessage,
    rollback,
    reset,
  };
}
