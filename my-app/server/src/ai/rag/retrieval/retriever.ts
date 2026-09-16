/**
 * ============================================
 * 知识库在线检索器（Retriever）
 * ============================================
 *
 * 【职责】
 * 把用户问题向量化，用 pgvector 的余弦距离运算符（<=>）检索 Top-K 个
 * 最相关的文档分块，返回分块内容 + 来源文档标题 + 分块序号 + 相似度分数。
 *
 * 【余弦距离 vs 余弦相似度】
 * pgvector 的 <=> 返回的是"余弦距离"（1 - 余弦相似度），距离越小越相似。
 * 因此相似度分数 = 1 - 距离，范围约 [-1, 1]，1 表示完全一致。
 */

import prisma from "../../../lib/prisma.js";
import { embedText } from "../../llm/embedding.js";
import { getDecryptedSiliconflowKey } from "../../../services/siliconflowKey.service.js";

/** 默认检索条数 */
export const DEFAULT_TOP_K = 5;

/** 单条检索结果 */
export interface RetrievedChunk {
  /** 分块文本 */
  content: string;
  /** 来源文档标题 */
  documentTitle: string;
  /** 分块序号（从 0 开始，用于溯源定位） */
  chunkIndex: number;
  /** 相似度分数（1 - 余弦距离，越大越相似） */
  score: number;
}

/** $queryRaw 返回的原始行结构 */
interface RetrievedRow {
  content: string;
  documentTitle: string;
  chunkIndex: number;
  score: number;
}

/**
 * 检索与 query 最相关的 Top-K 个分块（仅限当前用户的知识库）。
 *
 * @param userId - 当前用户 ID
 * @param query - 用户问题
 * @param topK - 返回条数，默认 5，内部钳制到 [1, 20]
 * @returns 按相似度降序排列的分块数组
 */
export async function retrieveChunks(
  userId: string,
  query: string,
  topK: number = DEFAULT_TOP_K
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

  // ---------- 1. 向量化查询 ----------
  // 【P5 修正】读取用户级 SiliconFlow Key（优先用户配置，服务端 env 兜底）
  const siliconflowKey = await getDecryptedSiliconflowKey(userId);
  const queryEmbedding = await embedText(trimmedQuery, siliconflowKey);
  const vectorLiteral = `[${queryEmbedding.join(",")}]`;

  // ---------- 2. 用余弦距离检索 Top-K ----------
  // ORDER BY <=> ASC：距离越小（越相似）越靠前
  const rows = await prisma.$queryRaw<RetrievedRow[]>`
    SELECT
      c.content AS content,
      d.title AS "documentTitle",
      c.chunk_index AS "chunkIndex",
      (1 - (c.embedding <=> ${vectorLiteral}::vector)) AS score
    FROM chunks c
    INNER JOIN documents d ON d.id = c.document_id
    WHERE d.user_id = ${userId}
    ORDER BY c.embedding <=> ${vectorLiteral}::vector ASC
    LIMIT ${limit}
  `;

  // ---------- 3. 规范化返回（分数保留 4 位小数） ----------
  return rows.map((row) => ({
    content: row.content,
    documentTitle: row.documentTitle,
    chunkIndex: Number(row.chunkIndex),
    score: Number(Number(row.score).toFixed(4)),
  }));
}
