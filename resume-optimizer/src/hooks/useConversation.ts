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
  optimizeResumeStream,
  chatResumeStream,
  parseResumeApi,
  getDeepSeekKeyStatusApi,
  analyzeResumeMatch,
} from "../api";
import { useThinkingPreference } from "./useThinkingPreference";
import type {
  OptimizeResult,
  ChatResult,
  ChatMessage,
  ResumeSuggestion,
  ResumeTag,
  ChangeItem,
  SectionContext,
  MatchResult,
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
  /** 目标岗位描述 JD（可选，填写后触发岗位匹配度评估） */
  jobDescription: string;
  wordCount: number;
  score: number;
  tags: ResumeTag[];
  highlights: string[];
  suggestions: ResumeSuggestion[];
  /** 岗位匹配度结果（null 表示未评估或评估失败，Step3 据此决定是否展示匹配度卡片） */
  matchResult: MatchResult | null;
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
  // ---------- 深度思考（逐字流式） ----------
  /**
   * 当前这一轮是否正在思考。
   *
   * 首轮优化与对话修改共用这三个字段作为「进行中」的载体：
   * 每次发起请求都会重置，流结束时置 false。
   */
  thinkingActive: boolean;
  /** 当前这一轮已到达的思考过程全文（增量累积） */
  thinkingContent: string;
  /** 当前这一轮思考耗时（毫秒） */
  thinkingMs: number;
  /**
   * 首轮优化的思考过程快照。
   *
   * 单独存一份的原因：上面的 thinking* 字段是「当前轮」的临时载体，
   * 一进入对话就会被下一轮覆盖；而首轮优化的思考需要留在 Step3 供用户回看。
   * 对话轮次的思考则跟着 assistant 消息走（见 ChatMessage.reasoning）。
   */
  optimizeThinking: { content: string; ms: number };
}

// ========== Hook ==========

export function useConversation() {
  /** 深度思考偏好（全局熔断 ∩ 本地偏好），effective 为实际下发值 */
  const thinking = useThinkingPreference();

  const [state, setState] = useState<ConversationState>({
    step: 1,
    file: null,
    resumeText: "",
    jobDescription: "",
    wordCount: 0,
    score: 0,
    tags: [],
    highlights: [],
    suggestions: [],
    matchResult: null,
    currentResume: "",
    versions: [],
    currentVersionIndex: -1,
    messages: [],
    changes: [],
    isOptimizing: false,
    isStreaming: false,
    error: null,
    needApiKey: false,
    thinkingActive: false,
    thinkingContent: "",
    thinkingMs: 0,
    optimizeThinking: { content: "", ms: 0 },
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

  /** 输入目标岗位描述 JD（可选，填写后优化时会额外做匹配度评估） */
  const handleJobInput = useCallback((jd: string) => {
    setState((s) => ({ ...s, jobDescription: jd }));
  }, []);

  // ========== 步骤 2：解析 + 首轮优化 ==========

  // 跟踪当前请求的 AbortController，用户返回/重试时取消挂起的请求
  const abortRef = useRef<AbortController | null>(null);

  const startOptimize = useCallback(async () => {
    const { file, resumeText, jobDescription } = state;
    if (!file && !resumeText.trim()) return;

    // 取消上一次挂起的请求
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState((s) => ({
      ...s,
      step: 2,
      isOptimizing: true,
      error: null,
      needApiKey: false,
      // 重置思考面板，避免上一轮内容残留到这一轮
      thinkingActive: false,
      thinkingContent: "",
      thinkingMs: 0,
    }));

    // 本轮思考起点：完成后用它算出「已深度思考 N 秒」
    const thinkingStartedAt = Date.now();
    /**
     * 本轮思考全文的**局部**累积变量。
     *
     * 不能读 state.thinkingContent：闭包捕获的是本次调用创建时的快照，
     * 整个流跑完它都还是空串。局部变量才是这一轮真实累积的结果。
     */
    let optimizeReasoning = "";

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

      // 并行：优化简历 + 评估岗位匹配度（仅当填写了 JD 时）
      // 匹配度是增强能力，失败静默返回 null，不阻断简历优化主流程
      const matchPromise = jobDescription.trim()
        ? analyzeResumeMatch(textToOptimize, jobDescription.trim())
        : Promise.resolve(null);

      // 调用 AI 优化（SSE 流式）：思考过程逐字回调，结构化结果在 done 事件里。
      // 用 Promise 把「回调式流」收敛成「一次性结果」，便于沿用下面的同步流程。
      const data = await new Promise<OptimizeResult | null>((resolve) => {
        optimizeResumeStream(
          textToOptimize,
          {
            onStart: (meta) => {
              // 以后端判定为准（它已叠加全局熔断开关），避免前后端判断不一致
              const on = meta?.thinking?.enabled === true;
              setState((s) => ({ ...s, thinkingActive: on }));
            },
            onReasoningDelta: (delta) => {
              // 增量追加 —— 这就是「逐字流式」的落点
              optimizeReasoning += delta;
              setState((s) => ({
                ...s,
                thinkingContent: s.thinkingContent + delta,
              }));
            },
            onDone: (result) => resolve(result),
            onError: (message, code) => {
              setState((s) => ({
                ...s,
                error: message,
                // 后端兜底拦截：未配置 Key 时置 needApiKey，引导去配置
                needApiKey: code === "DEEPSEEK_KEY_NOT_CONFIGURED",
                isOptimizing: false,
                thinkingActive: false,
              }));
              resolve(null);
            },
          },
          { thinking: thinking.effective, signal: controller.signal }
        ).then(() => {
          // 流正常结束却没收到 done（极端情况）→ 兜底解除等待。
          // Promise 的 resolve 幂等，重复调用无副作用。
          resolve(null);
        });
      });

      if (controller.signal.aborted) return;
      if (!data) {
        // 错误已由 onError 写入 state（或用户主动取消），这里只负责收尾
        setState((s) => ({ ...s, isOptimizing: false, thinkingActive: false }));
        return;
      }

      // 等待匹配度评估完成（若未填 JD，matchPromise 已 resolve 为 null）
      const matchResult = await matchPromise;
      // 本轮思考总耗时（用于完成后展示「已深度思考 N 秒」）
      const thinkingMs = Date.now() - thinkingStartedAt;

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
        matchResult,
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
        // 思考结束：停表。同时存一份快照，Step3 里仍可回看这次优化的思考过程
        thinkingActive: false,
        thinkingMs,
        optimizeThinking: { content: optimizeReasoning, ms: thinkingMs },
      }));
    } catch (err: any) {
      // 静默错误（用户取消/导航离开）不显示给用户
      if (err?.code === "CANCELLED" || err?.silent) return;
      setState((s) => ({
        ...s,
        error: err?.message || "优化失败",
        isOptimizing: false,
        thinkingActive: false,
      }));
    }
  }, [state.file, state.resumeText, state.jobDescription, thinking.effective]);

  // ========== 步骤 3：对话式迭代 ==========

  const sendMessage = useCallback(
    async (text: string, sectionContext?: SectionContext) => {
      if (!text.trim() || !state.currentResume) return;

      const userMsg: ChatMessage = { role: "user", content: text };
      setState((s) => ({
        ...s,
        messages: [...s.messages, userMsg],
        isStreaming: true,
        // 重置本轮思考：多轮对话里每一轮各有自己的思考链
        thinkingActive: false,
        thinkingContent: "",
        thinkingMs: 0,
      }));

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      // 局部累积本轮思考（同 startOptimize：不能读闭包里的 state）
      let roundReasoning = "";
      let roundStartedAt = Date.now();

      try {
        // 用 Promise 把「回调式流」收敛成一次性结果，便于沿用下面的同步流程
        const data = await new Promise<ChatResult | null>((resolve) => {
          chatResumeStream(
            {
              resume: state.currentResume,
              message: text,
              history: state.messages,
              context: sectionContext,
            },
            {
              onStart: (meta) => {
                roundStartedAt = Date.now();
                // 以后端判定为准（它已叠加全局熔断开关）
                const on = meta?.thinking?.enabled === true;
                setState((s) => ({ ...s, thinkingActive: on }));
              },
              onReasoningDelta: (delta) => {
                roundReasoning += delta;
                setState((s) => ({
                  ...s,
                  thinkingContent: s.thinkingContent + delta,
                }));
              },
              onDone: (result) => resolve(result),
              onError: (message, code) => {
                setState((s) => ({
                  ...s,
                  isStreaming: false,
                  error: message,
                  needApiKey: code === "DEEPSEEK_KEY_NOT_CONFIGURED",
                  thinkingActive: false,
                }));
                resolve(null);
              },
            },
            { thinking: thinking.effective, signal: controller.signal }
          ).then(() => resolve(null));
        });

        if (controller.signal.aborted) return;
        if (!data) {
          // 错误已由 onError 写入 state（或用户主动取消），这里只负责收尾
          setState((s) => ({ ...s, isStreaming: false, thinkingActive: false }));
          return;
        }

        const previousLength = state.versions.length;
        const roundThinkingMs = roundReasoning
          ? Date.now() - roundStartedAt
          : 0;

        const newVersion: ResumeVersion = {
          id: `v${previousLength}`,
          index: previousLength,
          resume: data.optimized,
          changes: data.changes,
          label: `第 ${previousLength} 轮修改`,
          timestamp: Date.now(),
        };

        const assistantMsg: ChatMessage = {
          role: "assistant",
          content: data.reply || "已修改",
          // 本轮思考跟着助手消息走，用户回看历史时不会张冠李戴
          ...(roundReasoning
            ? { reasoning: roundReasoning, reasoningMs: roundThinkingMs }
            : {}),
        };

        setState((s) => ({
          ...s,
          currentResume: data.optimized,
          versions: [...s.versions, newVersion],
          currentVersionIndex: previousLength,
          messages: [...s.messages, assistantMsg],
          changes: data.changes,
          isStreaming: false,
          thinkingActive: false,
          thinkingMs: roundThinkingMs,
        }));
      } catch (err: any) {
        setState((s) => ({
          ...s,
          isStreaming: false,
          thinkingActive: false,
          error: err?.message || "对话请求失败",
        }));
      }
    },
    [state.currentResume, state.messages, state.versions, thinking.effective]
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
      jobDescription: "",
      wordCount: 0,
      score: 0,
      tags: [],
      highlights: [],
      suggestions: [],
      matchResult: null,
      currentResume: "",
      versions: [],
      currentVersionIndex: -1,
      messages: [],
      changes: [],
      isOptimizing: false,
      isStreaming: false,
      error: null,
      needApiKey: false,
      thinkingActive: false,
      thinkingContent: "",
      thinkingMs: 0,
      optimizeThinking: { content: "", ms: 0 },
    });
  }, []);

  return {
    ...state,
    /** 深度思考偏好：开关 UI 与下发值都用它 */
    thinking,
    goToStep,
    handleFileUpload,
    handleTextInput,
    handleJobInput,
    startOptimize,
    sendMessage,
    rollback,
    reset,
  };
}
