/**
 * ============================================
 * 知识库离线写入器（Indexer / 入库）
 * ============================================
 *
 * 【职责】
 * 把用户上传的文档做「分块 → 向量化 → 写入 pgvector」三步处理：
 * 1. 用 chunkText 把全文切块；
 * 2. 用 embedTexts 批量向量化；
 * 3. 用 $queryRaw 写 documents + chunks 两张表（向量以 '[...]'::vector 写入）。
 *
 * 【为什么用 $queryRaw 而不是 Prisma ORM？】
 * Chunk.embedding 在 schema 里声明为 Unsupported("vector(1024)")，
 * Prisma 客户端不生成该字段的读写方法，因此读写必须走原生 SQL。
 */

import { randomUUID } from "node:crypto";
import prisma from "../../../lib/prisma.js";
import { chunkText } from "./chunker.js";
import { embedTexts } from "../../llm/embedding.js";

/** 入库结果 */
export interface IngestResult {
  /** 新文档 ID */
  documentId: string;
  /** 分块数量 */
  chunkCount: number;
}

/**
 * 文档入库：分块 → 向量化 → 写 documents + chunks。
 *
 * @param userId - 当前用户 ID
 * @param title - 文档标题
 * @param content - 文档全文（P3 仅支持纯文本）
 * @returns 入库结果（documentId + chunkCount）
 * @throws 标题/内容为空、embedding 失败、DB 写入失败时抛出中文错误
 */
export async function ingestDocument(
  userId: string,
  title: string,
  content: string
): Promise<IngestResult> {
  // ---------- 1. 参数校验 ----------
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

  // 先生成文档 ID（@default(uuid()) 只对 ORM 生效，raw SQL 需手动生成）
  const documentId = randomUUID();

  // ---------- 2. 分块 ----------
  const chunks = chunkText(trimmedContent);
  if (chunks.length === 0) {
    // 极端情况：内容全是空白导致无块可切，返回 0 块（文档仍保留原文）
    return { documentId, chunkCount: 0 };
  }

  // ---------- 3. 批量向量化 ----------
  // 【P3 修正】向量化提前到写库之前执行：
  // 若 embedding 失败（无 Key / 网络异常），此处直接抛错，documents 表不会写入，
  // 避免出现「有 documents 记录但无 chunks 的脏数据」。原实现先写 documents 再向量化，
  // 失败时会残留无 chunk 的文档记录（非事务性）。
  const embeddings = await embedTexts(chunks);

  // ---------- 4. 写入文档表（documents） ----------
  // 【P3 修正】移到向量化成功之后，保证入库的是完整可检索的文档
  await prisma.$queryRaw`
    INSERT INTO documents (id, user_id, title, content, created_at)
    VALUES (${documentId}, ${userId}, ${trimmedTitle}, ${trimmedContent}, now())
  `;

  // ---------- 5. 逐块写入 chunks（含向量） ----------
  for (let i = 0; i < chunks.length; i++) {
    const chunkId = randomUUID();
    // 向量转成 pgvector 可接受的字符串字面量 '[0.1,0.2,...]'，配合 SQL 的 ::vector 强转
    const vectorLiteral = `[${embeddings[i].join(",")}]`;

    await prisma.$queryRaw`
      INSERT INTO chunks (id, document_id, chunk_index, content, embedding, created_at)
      VALUES (${chunkId}, ${documentId}, ${i}, ${chunks[i]}, ${vectorLiteral}::vector, now())
    `;
  }

  return { documentId, chunkCount: chunks.length };
}
