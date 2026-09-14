/**
 * ============================================
 * 简历分析图节点（ResumeGraph Nodes）
 * ============================================
 *
 * 【职责】
 * 实现 ResumeGraph 的各个执行节点：
 * - parseNode   ：纯文本处理，规范化简历文本（无 LLM 调用）
 * - analyzeNode ：调用 DeepSeek 流式分析简历（有 LLM 调用）
 *
 * 【trace 埋点】
 * 每个节点在入口记录开始时间，出口调用 collectTrace 记录
 * { nodeName, input, output, durationMs, timestamp }，供 AI Trace 面板消费。
 */

import type { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { ResumeState } from "./state.js";
import { collectTrace } from "../../trace/tracer.js";

/** 分析节点的系统提示词：要求模型输出结构化的中文简历分析报告 */
const ANALYSIS_SYSTEM_PROMPT = `你是一位资深 HR 与简历优化专家，擅长快速识别简历中的亮点与问题。

请对用户提供的简历内容进行专业分析，并用中文输出结构化分析报告（Markdown 格式），包含以下部分：
1. **整体评分**（0-100 分）与一句话总评
2. **核心亮点**：列出 3-5 条简历中值得保留的优势
3. **主要问题**：指出格式、内容、量化数据、关键词等方面的不足
4. **改进建议**：给出具体、可执行的修改建议
5. **关键词建议**：针对互联网/技术类岗位建议补充的关键词

要求：
- 客观、具体，避免空泛套话
- 建议要可落地，最好给出改写示例
- 全程使用中文`;

/**
 * 将 AIMessage 的 content 统一转为字符串。
 *
 * content 可能是纯字符串（DeepSeek 文本输出即如此），
 * 也可能是内容块数组（多模态场景），这里统一归并为文本。
 * 参数用 unknown 承接，避免依赖 @langchain/core 内部类型名在不同版本间的差异。
 */
function contentToText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  // Array.isArray 的收窄结果是 any[]，这里显式转 unknown[] 保持严格类型
  const parts = content as unknown[];

  return parts
    .map((part: unknown) => {
      if (typeof part === "string") {
        return part;
      }
      const text = (part as { text?: unknown } | null)?.text;
      return typeof text === "string" ? text : "";
    })
    .join("");
}

/**
 * 解析节点（纯文本处理，不调用 LLM）。
 *
 * 对简历原文做轻量规范化：
 * 1. 统一换行符（\r\n、\r 统一为 \n）
 * 2. 去掉每行行尾空白
 * 3. 折叠 3 个及以上的连续空行为 1 个空行
 * 4. 去除首尾空白
 */
export function parseNode(state: ResumeState): Partial<ResumeState> {
  const startedAt = Date.now();

  const normalized = state.resumeText
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const output: Partial<ResumeState> = { resumeText: normalized };

  collectTrace({
    nodeName: "parse",
    input: { resumeText: state.resumeText },
    output,
    durationMs: Date.now() - startedAt,
    timestamp: new Date().toISOString(),
  });

  return output;
}

/**
 * 创建分析节点（工厂函数）。
 *
 * 通过闭包注入已配置好的 DeepSeek 模型实例，使节点函数保持纯逻辑、
 * 不依赖全局状态。节点内部调用 llm.invoke 发起分析，
 * 由于模型开启了 streaming，LangGraph 的 streamMode: "messages"
 * 会自动把模型输出拆成逐 token 的 AIMessageChunk 对外流式产出。
 *
 * @param llm - 由 createDeepSeekChat 创建、已指向 DeepSeek 的模型实例
 */
export function createAnalyzeNode(llm: ChatOpenAI) {
  return async function analyzeNode(
    state: ResumeState
  ): Promise<Partial<ResumeState>> {
    const startedAt = Date.now();

    const messages = [
      new SystemMessage(ANALYSIS_SYSTEM_PROMPT),
      new HumanMessage(`请分析以下简历内容：\n\n${state.resumeText}`),
    ];

    // 调用流式模型（streaming: true），LangGraph 会在 messages 模式下逐 token 输出
    const response = await llm.invoke(messages);

    const analysis = contentToText(response.content);

    const output: Partial<ResumeState> = {
      analysis,
      messages: [response],
    };

    collectTrace({
      nodeName: "analyze",
      input: { resumeText: state.resumeText },
      output: { analysis },
      durationMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    });

    return output;
  };
}
