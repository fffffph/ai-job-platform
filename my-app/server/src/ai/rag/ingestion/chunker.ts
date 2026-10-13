/**
 * ============================================
 * 结构感知分块器（Chunker）
 * ============================================
 *
 * 【职责】
 * 把长文档切成适合向量检索的文本块（chunk）。
 *
 * 【分块策略】
 * 1. 结构感知：优先按「段落 / 标题」切分，尽量不让一句话被拦腰截断；
 * 2. 目标块大小约 512 字，块间重叠 128 字（保证跨块语义连续，检索不丢上下文）；
 * 3. 单个逻辑段超长（如超长段落/代码块）时按固定窗口硬切，重叠同样生效。
 *
 * 【为什么需要重叠？】
 * 固定不重叠切分会把一句完整信息切成两半，导致向量语义断裂。
 * 相邻块保留 128 字重叠，可显著提升检索召回质量。
 */

/** 每块目标字数（约 512 字） */
export const CHUNK_SIZE = 512;

/** 相邻块之间的重叠字数（128 字） */
export const CHUNK_OVERLAP = 128;

/**
 * chunkText 的可选参数（P3 参数收敛：由配置中心注入）。
 *
 * 所有字段均可选，缺省时回退到本文件顶部的内置默认值。
 */
export interface ChunkOptions {
  /** 每块目标字数（默认 512，配置项 rag.chunk_size） */
  chunkSize?: number;
  /** 相邻块重叠字数（默认 128，配置项 rag.chunk_overlap） */
  chunkOverlap?: number;
}

/**
 * 对文本进行结构感知分块。
 *
 * @param text    - 原始全文
 * @param options - 可选参数（分块大小/重叠），缺省走内置默认值
 * @returns 分块后的字符串数组（不含空白块）
 */
export function chunkText(text: string, options?: ChunkOptions): string[] {
  // 参数收敛：分块大小与重叠从配置中心注入，缺省走默认值
  const chunkSize = options?.chunkSize ?? CHUNK_SIZE;
  const chunkOverlap = options?.chunkOverlap ?? CHUNK_OVERLAP;

  // 统一换行符并去除首尾空白
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  if (!normalized) {
    return [];
  }

  // 1. 切分成逻辑段（标题 + 段落）
  const segments = splitIntoLogicalSegments(normalized);
  if (segments.length === 0) {
    return [];
  }

  const chunks: string[] = [];
  let current = "";

  for (const seg of segments) {
    // 单个逻辑段过长：先冲刷已有块，再对该段做固定窗口硬切
    if (seg.length > chunkSize) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      chunks.push(...hardSplit(seg, chunkSize, chunkOverlap));
      continue;
    }

    // 正常合并：当前块 + 该段不超过目标大小则继续累积
    const candidate = current ? `${current}\n\n${seg}` : seg;

    if (candidate.length > chunkSize) {
      // 超出目标大小：结束当前块，并用上一块尾部重叠字作为下一块的开头（重叠）
      chunks.push(current);
      current = `${current.slice(-chunkOverlap)}\n\n${seg}`;
    } else {
      current = candidate;
    }
  }

  // 冲刷最后一块
  if (current.trim()) {
    chunks.push(current);
  }

  return chunks;
}

/**
 * 把文本切成逻辑段（标题段 / 段落段）。
 *
 * 先按空行切段落，再在段内识别 markdown 标题（# 开头）与
 * 编号标题（1. / 一、 等），把标题单独拆成一个段，保证标题信息不丢。
 */
function splitIntoLogicalSegments(text: string): string[] {
  const paragraphs = text.split(/\n{2,}/);
  const segments: string[] = [];

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) {
      continue;
    }

    const lines = trimmed.split("\n");
    let buffer = "";

    for (const line of lines) {
      if (isHeadingLine(line)) {
        // 标题独立成段
        if (buffer.trim()) {
          segments.push(buffer.trim());
          buffer = "";
        }
        segments.push(line.trim());
      } else {
        buffer = buffer ? `${buffer}\n${line}` : line;
      }
    }

    if (buffer.trim()) {
      segments.push(buffer.trim());
    }
  }

  return segments;
}

/**
 * 判断一行是否为标题。
 * - markdown 标题：# 开头（# 到 ######）
 * - 数字编号标题：1. / 1、 / 1)
 * - 中文编号标题：一、 / 一.
 *
 * 编号标题做了长度限制（≤40 字），避免把"1. 我有 5 年经验……"这类长句误判为标题。
 */
function isHeadingLine(line: string): boolean {
  const t = line.trim();
  if (!t) {
    return false;
  }
  if (/^#{1,6}\s+/.test(t)) {
    return true;
  }
  if (/^\d+[.、)]\s*/.test(t) && t.length <= 40) {
    return true;
  }
  if (/^[一二三四五六七八九十]+[、.]\s*/.test(t) && t.length <= 40) {
    return true;
  }
  return false;
}

/**
 * 固定窗口硬切（用于超长段落/代码块）。
 *
 * 从 start 开始每次切 size 字，下一窗口回退 overlap 字实现重叠。
 */
function hardSplit(text: string, size: number, overlap: number): string[] {
  const parts: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + size, text.length);
    parts.push(text.slice(start, end));
    if (end >= text.length) {
      break;
    }
    start = end - overlap;
  }

  return parts;
}
