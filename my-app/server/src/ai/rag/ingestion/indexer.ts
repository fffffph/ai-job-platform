/**
 * ============================================
 * 知识库离线写入器（Indexer / 入库）
 * ============================================
 *
 * 【职责】
 * 把用户上传的知识做「分块 → 向量化 → 写入 pgvector」三步处理：
 * 1. 用 chunkText 把全文切块；
 * 2. 用 embedTexts 批量向量化；
 * 3. 用 $queryRaw 写 documents + chunks 两张表（向量以 '[...]'::vector 写入）。
 *
 * 【为什么用 $queryRaw 而不是 Prisma ORM？】
 * Chunk.embedding 在 schema 里声明为 Unsupported("vector(1024)")，
 * Prisma 客户端不生成该字段的读写方法，因此读写必须走原生 SQL。
 *
 * 【知识库文件解析】
 * - Document 增加 keywords（检索词）/ category（分类）字段；
 * - ingestEntries 支持批量入库 + replace（清空旧知识全量重建）/ append（追加）；
 * - 原始 Excel 文件由 file-store.ts 单独保存（文件真相源）。
 */

import { randomUUID } from "node:crypto";
import prisma from "../../../lib/prisma.js";
import { chunkText } from "./chunker.js";
import { embedTexts } from "../../llm/embedding.js";
import { getDecryptedSiliconflowKey } from "../../../services/siliconflowKey.service.js";
import type { KnowledgeEntry } from "./excel-parser.js";

/** 单条入库结果 */
export interface IngestResult {
  /** 新文档 ID */
  documentId: string;
  /** 分块数量 */
  chunkCount: number;
}

/** 批量入库结果 */
export interface IngestEntriesResult {
  /** 入库的条目数 */
  documentCount: number;
  /** 总的分块数 */
  chunkCount: number;
}

/**
 * 单条入库（内部函数，apiKey 由调用方传入，避免批量时每条重复读 Key）。
 *
 * @param userId - 当前用户 ID
 * @param title - 条目标题
 * @param content - 条目内容
 * @param keywords - 检索词（逗号分隔，可空）
 * @param category - 分类（可空）
 * @param apiKey - 已解密的 SiliconFlow Key
 */
async function ingestOne(
  userId: string,
  title: string,
  content: string,
  keywords: string | undefined,
  category: string | undefined,
  apiKey: string
): Promise<IngestResult> {
  const documentId = randomUUID();
  const chunks = chunkText(content);

  // 无块可切（内容全是空白等极端情况）：仍写文档（保留原文），chunkCount 记 0
  if (chunks.length === 0) {
    await prisma.$queryRaw`
      INSERT INTO documents (id, user_id, title, content, keywords, category, created_at)
      VALUES (${documentId}, ${userId}, ${title}, ${content}, ${keywords || null}, ${category || null}, now())
    `;
    return { documentId, chunkCount: 0 };
  }

  // 向量化提前到写库之前：embedding 失败则直接抛错，documents 不写，避免脏数据
  const embeddings = await embedTexts(chunks, apiKey);

  await prisma.$queryRaw`
    INSERT INTO documents (id, user_id, title, content, keywords, category, created_at)
    VALUES (${documentId}, ${userId}, ${title}, ${content}, ${keywords || null}, ${category || null}, now())
  `;

  for (let i = 0; i < chunks.length; i++) {
    const chunkId = randomUUID();
    const vectorLiteral = `[${embeddings[i].join(",")}]`;

    await prisma.$queryRaw`
      INSERT INTO chunks (id, document_id, chunk_index, content, embedding, created_at)
      VALUES (${chunkId}, ${documentId}, ${i}, ${chunks[i]}, ${vectorLiteral}::vector, now())
    `;
  }

  return { documentId, chunkCount: chunks.length };
}

/**
 * 单条文档入库（保留接口，供 /knowledge/upload 文本上传使用）。
 *
 * @param userId - 当前用户 ID
 * @param title - 文档标题
 * @param content - 文档全文
 * @param keywords - 检索词（可选）
 * @param category - 分类（可选）
 * @throws 标题/内容为空、embedding 失败、DB 写入失败时抛出中文错误
 */
export async function ingestDocument(
  userId: string,
  title: string,
  content: string,
  keywords?: string,
  category?: string
): Promise<IngestResult> {
  const trimmedTitle = title.trim();
  const trimmedContent = content.trim();

  if (!userId) {
    throw new Error("用户 ID 不能为空");
  }
  if (!trimmedTitle) {
    throw new Error("文档标题不能为空");
  }
  if (!trimmedContent) {
    throw new Error("文档内容不能为空");
  }

  const apiKey = await getDecryptedSiliconflowKey(userId);
  return ingestOne(
    userId,
    trimmedTitle,
    trimmedContent,
    keywords?.trim() || undefined,
    category?.trim() || undefined,
    apiKey
  );
}

/**
 * 批量入库（Excel 导入用）。
 *
 * @param userId - 当前用户 ID
 * @param entries - 已通过校验的结构化条目数组
 * @param mode - replace（默认，清空旧知识后全量重建）/ append（只追加，不动旧的）
 * @returns 入库的条目数 + 总分块数
 * @throws 无条目、embedding 失败、DB 写入失败时抛出中文错误
 */
export async function ingestEntries(
  userId: string,
  entries: KnowledgeEntry[],
  mode: "replace" | "append" = "replace"
): Promise<IngestEntriesResult> {
  if (!userId) {
    throw new Error("用户 ID 不能为空");
  }
  if (entries.length === 0) {
    throw new Error("没有可入库的知识条目，请检查文件内容");
  }

  // replace：先清空该用户全部旧文档（chunks 通过 FK ON DELETE CASCADE 级联删除）
  if (mode === "replace") {
    await prisma.$executeRaw`DELETE FROM documents WHERE user_id = ${userId}`;
  }

  // 只读一次 Key，避免批量时每条重复解密查询
  const apiKey = await getDecryptedSiliconflowKey(userId);

  let chunkCount = 0;
  for (const entry of entries) {
    const result = await ingestOne(
      userId,
      entry.title,
      entry.content,
      entry.keywords,
      entry.category,
      apiKey
    );
    chunkCount += result.chunkCount;
  }

  return { documentCount: entries.length, chunkCount };
}
