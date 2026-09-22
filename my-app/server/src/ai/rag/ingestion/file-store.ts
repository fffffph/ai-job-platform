/**
 * ============================================
 * 知识库文件真相源存储（File Store）
 * ============================================
 *
 * 【职责】
 * 保存/读取用户上次上传的原始 Excel 文件，支撑「下载上次文件」能力。
 *
 * 【为什么叫「文件真相源」？】
 * 用户的 Excel 文件是其知识库的唯一真相源：
 * - 首次下载模板 → 填内容 → 上传；
 * - 之后「下载上次文件」→ 增删改 → 重新上传（同步替换）。
 * 因此每次上传成功后都要把原始 .xlsx 字节存下来，供下次下载继续编辑。
 *
 * 【存储方式】
 * 每用户一份（userId 唯一），存 PostgreSQL bytea 字段。Excel 通常几十~几百 KB，
 * 存库足够；相比落磁盘，天然随用户数据走、无需额外挂载卷与清理逻辑。
 */

import prisma from "../../../lib/prisma.js";

/** 知识文件记录（含字节内容） */
export interface KnowledgeFileRecord {
  /** 原始文件名（含 .xlsx 后缀） */
  filename: string;
  /** 文件二进制内容 */
  content: Buffer;
}

/**
 * 保存（upsert）用户上次上传的原始 Excel 文件。
 *
 * @param userId - 当前用户 ID
 * @param filename - 原始文件名
 * @param content - 文件二进制内容
 */
export async function saveKnowledgeFile(
  userId: string,
  filename: string,
  content: Buffer
): Promise<void> {
  await prisma.knowledgeFile.upsert({
    where: { userId },
    create: { userId, filename, content: new Uint8Array(content) },
    update: { filename, content: new Uint8Array(content) },
  });
}

/**
 * 读取用户上次上传的原始 Excel 文件。
 *
 * @param userId - 当前用户 ID
 * @returns 文件记录，未上传过返回 null
 */
export async function getKnowledgeFile(
  userId: string
): Promise<KnowledgeFileRecord | null> {
  const file = await prisma.knowledgeFile.findUnique({ where: { userId } });
  if (!file) {
    return null;
  }
  // Prisma 返回 Uint8Array，转成 Buffer 方便后续写响应
  return { filename: file.filename, content: Buffer.from(file.content) };
}

/** 文件元信息（不含内容，供前端判断「显示模板引导还是文件卡片」） */
export interface KnowledgeFileInfo {
  /** 原始文件名 */
  filename: string;
  /** 上次上传/更新时间 */
  updatedAt: Date;
}

/**
 * 读取用户上传文件的元信息（轻量，不含文件字节）。
 *
 * @param userId - 当前用户 ID
 * @returns 文件元信息，未上传过返回 null
 */
export async function getKnowledgeFileInfo(
  userId: string
): Promise<KnowledgeFileInfo | null> {
  const file = await prisma.knowledgeFile.findUnique({
    where: { userId },
    select: { filename: true, updatedAt: true },
  });
  return file;
}

/**
 * 删除用户保存的原始文件记录（只删文件真相源，不动已入库的知识）。
 *
 * @param userId - 当前用户 ID
 * @returns 是否删除成功
 */
export async function deleteKnowledgeFile(userId: string): Promise<boolean> {
  const result = await prisma.knowledgeFile.deleteMany({ where: { userId } });
  return result.count > 0;
}
