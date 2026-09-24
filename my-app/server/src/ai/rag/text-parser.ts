/**
 * ============================================
 * 文本知识解析器（Text Parser）
 * ============================================
 *
 * 【职责】
 * 把用户粘贴的自由文本解析成结构化知识条目，实现「文本输入也能按模板入库」。
 * 提供两级解析：
 *   1. 规则解析（免费、快）：按约定格式识别，无需调用 LLM；
 *   2. LLM 兜底（准确、耗 token）：规则解析无结果时，用 DeepSeek 结构化输出解析。
 *
 * 【规则解析的约定格式】（对齐 Excel 模板）
 *   # 知识点标题
 *   检索词：虚拟DOM, diff算法
 *   分类：前端/React
 *   知识点正文……
 *
 *   多个条目之间用新的 # 标题分隔。
 */

import { z } from "zod";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import type { KnowledgeEntry } from "./ingestion/excel-parser.js";
import { createDeepSeekChat, type DeepSeekChatOptions } from "../llm/deepseek.js";

// ============================================================
// LLM 兜底的结构化输出 Schema
// ============================================================

/** 单条知识条目 Schema（LLM 结构化输出用） */
export const KnowledgeEntrySchema = z.object({
  /** 知识点标题 */
  title: z.string().describe("知识点标题，一句话概括"),
  /** 知识点详细内容 */
  content: z.string().describe("知识点详细内容/答案正文"),
  /** 逗号分隔检索词（可空，帮助检索） */
  keywords: z.string().optional().describe("逗号分隔的检索词，用户可能用这些词提问"),
  /** 分类标签（可空） */
  category: z.string().optional().describe("分类标签，如「前端/React」"),
});

/** 文本解析结果 Schema */
export const ParseTextSchema = z.object({
  /** 从文本中解析出的知识条目列表 */
  entries: z.array(KnowledgeEntrySchema).describe("解析出的知识条目列表"),
});

/** LLM 兜底解析的系统 Prompt */
const PARSE_TEXT_SYSTEM_PROMPT = `你是知识库整理助手。请把用户粘贴的文本解析成结构化的知识条目列表。

要求：
1. 识别文本中的多个知识点（通常以标题、问题、编号或空行分隔），每条拆成一个条目；
2. 每个条目提取：标题（一句话概括）、内容（详细正文）、检索词（用户可能怎么提问，逗号分隔）、分类（可选）；
3. 若文本只是单一知识点，则只返回一条；
4. 检索词要覆盖该知识点的核心关键词，方便后续语义检索命中；
5. 分类可依据内容推断（如「前端/React」「后端/Node」「小程序」等），无法判断则留空。`;

// ============================================================
// 规则解析
// ============================================================

/**
 * 规则解析：把文本按约定格式解析成结构化条目（免费，不调 LLM）。
 *
 * 约定格式：
 *   # 标题
 *   检索词：xxx, yyy（可选）
 *   分类：xxx（可选）
 *   正文（必填）
 *
 * @param text - 用户粘贴的文本
 * @returns 解析出的条目数组；文本不符合约定格式时返回空数组
 */
export function parseTextToEntries(text: string): KnowledgeEntry[] {
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  if (!normalized) {
    return [];
  }

  // 按「行首 # 标题」切分条目块（正向前瞻，保留标题在块首）
  const blocks = normalized.split(/\n(?=#{1,6}\s+)/);
  const entries: KnowledgeEntry[] = [];

  for (const block of blocks) {
    const lines = block.split("\n");
    const titleMatch = lines[0].trim().match(/^#{1,6}\s+(.+)$/);
    // 非标题开头的块（如文本开头没有 # 的杂散内容）跳过
    if (!titleMatch) {
      continue;
    }

    const title = titleMatch[1].trim();
    let keywords = "";
    let category = "";
    const contentLines: string[] = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // 检索词 / 关键词 行
      const kwMatch = line.match(/^(检索词|关键词)\s*[:：]\s*(.+)$/);
      if (kwMatch) {
        keywords = kwMatch[2].trim();
        continue;
      }
      // 分类行
      const catMatch = line.match(/^分类\s*[:：]\s*(.+)$/);
      if (catMatch) {
        category = catMatch[1].trim();
        continue;
      }
      contentLines.push(line);
    }

    const content = contentLines.join("\n").trim();
    if (!title || !content) {
      continue; // 标题或内容为空，跳过
    }

    entries.push({
      title,
      content,
      keywords: keywords || undefined,
      category: category || undefined,
    });
  }

  return entries;
}

// ============================================================
// LLM 兜底解析
// ============================================================

/**
 * parseTextWithLLM 的可选参数（P3 参数收敛：由配置中心注入）。
 *
 * 所有字段均可选，缺省时回退到内置默认值。
 */
export interface ParseTextLLMOptions {
  /** 解析系统 Prompt（默认 PARSE_TEXT_SYSTEM_PROMPT，配置项 prompt.parse_text） */
  prompt?: string;
  /** 对话模型名（默认 deepseek-chat，配置项 llm.model） */
  model?: string;
  /** 采样温度（默认 0.3，配置项 llm.temperature） */
  temperature?: number;
  /** 单次最大 token（默认 4096，配置项 llm.max_tokens） */
  maxTokens?: number;
  /** 请求超时毫秒（默认 60000，配置项 llm.timeout_ms） */
  timeout?: number;
}

/**
 * LLM 兜底解析：用 DeepSeek 结构化输出把自由文本解析成条目。
 *
 * @param text    - 用户粘贴的文本
 * @param apiKey  - 用户级 DeepSeek Key（明文）
 * @param options - 可选参数（Prompt/模型/温度等），缺省走内置默认值
 * @returns 解析出的条目数组
 */
export async function parseTextWithLLM(
  text: string,
  apiKey: string,
  options?: ParseTextLLMOptions
): Promise<KnowledgeEntry[]> {
  const llmOptions: DeepSeekChatOptions = {
    model: options?.model,
    temperature: options?.temperature,
    maxTokens: options?.maxTokens,
    timeout: options?.timeout,
  };
  const llm = createDeepSeekChat(apiKey, llmOptions);
  // DeepSeek 结构化输出必须用 functionCalling（不支持 response_format）
  const structuredLlm = llm.withStructuredOutput(ParseTextSchema, {
    method: "functionCalling",
  });

  const result = (await structuredLlm.invoke([
    new SystemMessage(options?.prompt ?? PARSE_TEXT_SYSTEM_PROMPT),
    new HumanMessage(text),
  ])) as { entries: z.infer<typeof ParseTextSchema>["entries"] };

  return result.entries.map((e) => ({
    title: e.title,
    content: e.content,
    keywords: e.keywords?.trim() || undefined,
    category: e.category?.trim() || undefined,
  }));
}
