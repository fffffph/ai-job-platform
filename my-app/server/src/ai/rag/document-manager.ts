/**
 * ============================================
 * 知识库文档管理器（Document Manager）
 * ============================================
 *
 * 【职责】
 * 知识库文档的列表查询与删除管理，供「我的知识」列表使用。
 *
 * 【为什么用 $queryRaw 而不是 Prisma ORM？】
 * Chunk.embedding 是 Unsupported("vector")，且 chunks 数量统计、级联删除
 * 走原生 SQL 更直接可控（删除依赖 FK ON DELETE CASCADE 级联删 chunks）。
 */

import prisma from "../../lib/prisma.js";

/** 知识库文档条目（列表展示用） */
export interface KnowledgeDocumentItem {
  /** 文档 ID */
  id: string;
  /** 文档标题 */
  title: string;
  /** 检索词（逗号分隔，可空） */
  keywords: string | null;
  /** 分类（可空） */
  category: string | null;
  /** 分块数量 */
  chunkCount: number;
  /** 入库时间 */
  createdAt: Date;
}

/** $queryRaw 返回的原始行结构 */
interface DocRow {
  id: string;
  title: string;
  keywords: string | null;
  category: string | null;
  createdAt: Date;
  chunkCount: number;
}

/**
 * 列出当前用户的所有知识库文档（按入库时间倒序）。
 *
 * @param userId - 当前用户 ID
 * @returns 文档条目数组（含检索词/分类/分块数）
 */
export async function listDocuments(
  userId: string
): Promise<KnowledgeDocumentItem[]> {
  if (!userId) {
    throw new Error("用户 ID 不能为空");
  }

  const rows = await prisma.$queryRaw<DocRow[]>`
    SELECT
      d.id,
      d.title,
      d.keywords,
      d.category,
      d.created_at AS "createdAt",
      count(c.id)::int AS "chunkCount"
    FROM documents d
    LEFT JOIN chunks c ON c.document_id = d.id
    WHERE d.user_id = ${userId}
    GROUP BY d.id
    ORDER BY d.created_at DESC
  `;

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    keywords: r.keywords,
    category: r.category,
    chunkCount: Number(r.chunkCount),
    createdAt: r.createdAt,
  }));
}

/**
 * 删除单条文档（仅限本人，级联删除其 chunks）。
 *
 * @param userId - 当前用户 ID
 * @param documentId - 要删除的文档 ID
 * @returns 是否删除成功（文档不存在或不属于该用户时返回 false）
 */
export async function deleteDocument(
  userId: string,
  documentId: string
): Promise<boolean> {
  if (!userId || !documentId) {
    return false;
  }
  const result = await prisma.$executeRaw`
    DELETE FROM documents WHERE id = ${documentId} AND user_id = ${userId}
  `;
  return result > 0;
}
