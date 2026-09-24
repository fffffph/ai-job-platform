/**
 * ============================================
 * 知识库在线检索器（Retriever）
 * ============================================
 *
 * 【职责】
 * 把用户问题向量化，用 pgvector 的余弦距离运算符（<=>）检索 Top-K 个
 * 最相关的文档分块，返回分块内容 + 来源文档标题 + 分块序号 + 相似度分数。
 *
 * 【混合检索（知识库文件解析）】
 * 纯向量检索对「用户自定义检索词」不敏感。升级为：
 *   1. 向量检索召回 Top-K×3 候选；
 *   2. 读取各文档 keywords（检索词），统计查询命中的检索词数量；
 *   3. 融合打分：score = 向量相似度 + 0.15 × 命中检索词数；
 *   4. 按融合分重排，取 Top-K。
 * 这样用户给知识填的「检索词」能直接提升检索命中精度。
 *
 * 【余弦距离 vs 余弦相似度】
 * pgvector 的 <=> 返回"余弦距离"（1 - 余弦相似度），距离越小越相似。
 * 相似度分数 = 1 - 距离，范围约 [-1, 1]，1 表示完全一致。
 */

import prisma from "../../../lib/prisma.js";
import { embedText } from "../../llm/embedding.js";
import { getDecryptedSiliconflowKey } from "../../../services/siliconflowKey.service.js";

/** 默认检索条数 */
export const DEFAULT_TOP_K = 5;

/** 候选召回倍数（先召回 Top-K×3，再融合重排，避免关键词命中文档被向量检索漏掉） */
const CANDIDATE_MULTIPLIER = 3;

/** 单个检索词命中的加权分 */
const KEYWORD_BOOST = 0.15;

/**
 * retrieveChunks 的可选参数（P3 参数收敛：由配置中心注入）。
 *
 * 所有字段均可选，缺省时回退到本文件顶部的内置默认值。
 */
export interface RetrieveOptions {
  /** 候选召回倍数（默认 3，配置项 rag.candidate_multiplier） */
  candidateMultiplier?: number;
  /** 单个检索词命中的加权分（默认 0.15，配置项 rag.keyword_boost） */
  keywordBoost?: number;
  /** 向量化接口超时毫秒（默认 60000，配置项 rag.embedding_timeout_ms） */
  embeddingTimeoutMs?: number;
  /** 是否启用混合检索（默认 true，配置项 switch.hybrid_search）。false 时退化为纯向量检索，跳过关键词融合 */
  hybrid?: boolean;
}

/** 单条检索结果 */
export interface RetrievedChunk {
  /** 来源文档 ID（用于关键词命中融合） */
  documentId: string;
  /** 分块文本 */
  content: string;
  /** 来源文档标题 */
  documentTitle: string;
  /** 分块序号（从 0 开始，用于溯源定位） */
  chunkIndex: number;
  /** 融合相似度分数（向量相似度 + 关键词加权，越大越相似） */
  score: number;
}

/** $queryRaw 返回的原始行结构 */
interface RetrievedRow {
  documentId: string;
  content: string;
  documentTitle: string;
  chunkIndex: number;
  score: number;
}

/**
 * 检索与 query 最相关的 Top-K 个分块（仅限当前用户的知识库，混合检索）。
 *
 * @param userId - 当前用户 ID
 * @param query - 用户问题
 * @param topK - 返回条数，默认 5，内部钳制到 [1, 20]
 * @param options - 可选参数（候选召回倍数/检索词加权/超时），缺省走内置默认值
 * @returns 按融合分数降序排列的分块数组
 */
export async function retrieveChunks(
  userId: string,
  query: string,
  topK: number = DEFAULT_TOP_K,
  options?: RetrieveOptions
): Promise<RetrievedChunk[]> {
  const trimmedQuery = query.trim();
  if (!userId) {
    throw new Error("用户 ID 不能为空");
  }
  if (!trimmedQuery) {
    throw new Error("检索查询不能为空");
  }

  // 防御性钳制 topK，避免非法值导致 SQL 异常
  const limit = Number.isFinite(topK)
    ? Math.max(1, Math.min(20, Math.floor(topK)))
    : DEFAULT_TOP_K;

  // 参数收敛：候选召回倍数与检索词加权从配置中心注入，缺省走默认值
  const candidateMultiplier = options?.candidateMultiplier ?? CANDIDATE_MULTIPLIER;
  const keywordBoost = options?.keywordBoost ?? KEYWORD_BOOST;
  // 【P5 开关】混合检索开关：false 时退化为纯向量检索（跳过关键词融合 + 候选放大）
  const hybrid = options?.hybrid ?? true;

  // ---------- 1. 向量化查询 ----------
  const siliconflowKey = await getDecryptedSiliconflowKey(userId);
  const queryEmbedding = await embedText(trimmedQuery, siliconflowKey, {
    timeoutMs: options?.embeddingTimeoutMs,
  });
  const vectorLiteral = `[${queryEmbedding.join(",")}]`;

  // ---------- 2. 向量检索召回候选 ----------
  // 混合检索：先召回 Top-K×N 候选再融合重排（避免关键词命中文档被向量检索漏掉）；
  // 纯向量检索：无需候选放大，直接召回 Top-K。
  const candidateLimit = hybrid ? Math.min(20, limit * candidateMultiplier) : limit;
  const rows = await prisma.$queryRaw<RetrievedRow[]>`
    SELECT
      d.id AS "documentId",
      c.content AS content,
      d.title AS "documentTitle",
      c.chunk_index AS "chunkIndex",
      (1 - (c.embedding <=> ${vectorLiteral}::vector)) AS score
    FROM chunks c
    INNER JOIN documents d ON d.id = c.document_id
    WHERE d.user_id = ${userId}
    ORDER BY c.embedding <=> ${vectorLiteral}::vector ASC
    LIMIT ${candidateLimit}
  `;

  if (rows.length === 0) {
    return [];
  }

  // ---------- 3/4. 融合打分 + 重排 + Top-K ----------
  // 纯向量检索：直接按向量分数排序，跳过关键词命中统计（省一次查库）
  if (!hybrid) {
    return rows
      .map((row) => ({
        documentId: row.documentId,
        content: row.content,
        documentTitle: row.documentTitle,
        chunkIndex: Number(row.chunkIndex),
        score: Number(Number(row.score).toFixed(4)),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  // 混合检索：关键词命中统计（检索词融合）
  const docs = await prisma.document.findMany({
    where: { userId },
    select: { id: true, keywords: true },
  });
  const hitCount: Record<string, number> = {};
  for (const doc of docs) {
    hitCount[doc.id] = keywordHitCount(trimmedQuery, doc.keywords ?? undefined);
  }

  // 融合打分：向量相似度 + 检索词加权 × 命中数，再重排取 Top-K
  const merged = rows
    .map((row) => ({
      documentId: row.documentId,
      content: row.content,
      documentTitle: row.documentTitle,
      chunkIndex: Number(row.chunkIndex),
      score: Number(row.score) + keywordBoost * (hitCount[row.documentId] || 0),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  // 分数保留 4 位小数
  return merged.map((item) => ({
    ...item,
    score: Number(item.score.toFixed(4)),
  }));
}

/**
 * 统计查询字符串命中了多少个检索词。
 *
 * 把 keywords（逗号分隔）拆成词，判断每个词是否作为子串出现在查询里
 * （大小写不敏感、忽略空白）。命中越多，说明该文档与查询的关键词关联越强。
 *
 * @param query - 用户查询
 * @param keywords - 文档的逗号分隔检索词（可空）
 * @returns 命中的检索词数量
 */
function keywordHitCount(query: string, keywords?: string): number {
  if (!keywords) {
    return 0;
  }
  const q = query.toLowerCase().replace(/\s+/g, "");
  const words = keywords
    .split(/[,，、;；]/)
    .map((w) => w.trim().toLowerCase().replace(/\s+/g, ""))
    .filter(Boolean);

  let hits = 0;
  for (const w of words) {
    if (q.includes(w)) {
      hits += 1;
    }
  }
  return hits;
}
