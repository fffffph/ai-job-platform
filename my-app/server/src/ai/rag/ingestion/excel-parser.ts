/**
 * ============================================
 * Excel 知识条目解析器（Excel Parser）
 * ============================================
 *
 * 【职责】
 * 把用户上传的 .xlsx 文件解析成结构化知识条目，并负责生成导入模板。
 * 是「文件真相源」模型的核心：一份 Excel 维护多条知识，直接上传即可。
 *
 * 【模板列定义】
 * | 标题(必填) | 检索词(建议) | 分类(选填) | 内容(必填) |
 *
 * 【校验规则】
 * 1. 表头校验：首行必须含「标题」「内容」列（兼容英文 title/content）；
 * 2. 必填校验：每行标题、内容非空，空则记入 failed（行号 + 原因）；
 * 3. 全空行跳过。
 *
 * 【为什么用 aoa（二维数组）而非 sheet_to_json 直接转对象？】
 * 表头可能是中文/英文混合，且用户可能手改列名，直接转对象会静默丢列。
 * 手动按表头别名匹配列索引，校验更可控、错误提示更明确。
 */

import * as XLSX from "xlsx";

/** 单条结构化知识条目 */
export interface KnowledgeEntry {
  /** 知识点标题（必填） */
  title: string;
  /** 知识点详细内容（必填） */
  content: string;
  /** 逗号分隔检索词（建议填，提升检索命中） */
  keywords?: string;
  /** 分类标签（选填） */
  category?: string;
}

/** Excel 解析结果 */
export interface ExcelParseResult {
  /** 有效条目（标题、内容均非空） */
  entries: KnowledgeEntry[];
  /** 失败行（行号 + 原因），供前端逐条提示 */
  failed: { row: number; reason: string }[];
  /** 有效数据行总数（含失败行，不含表头和全空行） */
  total: number;
}

/** 表头别名映射：字段 → 可识别的列名（中文 + 英文，不区分大小写） */
const HEADER_ALIASES: Record<keyof KnowledgeEntry, string[]> = {
  title: ["标题", "title"],
  keywords: ["检索词", "关键词", "keywords"],
  category: ["分类", "category"],
  content: ["内容", "content"],
};

/** 模板列宽（列：标题/检索词/分类/内容） */
const TEMPLATE_COL_WIDTHS = [24, 24, 14, 60];

/**
 * 生成知识库导入模板 .xlsx。
 *
 * @returns .xlsx 文件的二进制 Buffer（供下载）
 */
export function buildTemplate(): Buffer {
  // 表头 + 一行示例（示例用「（示例，请删除）」标注，避免误入库）
  const header = ["标题", "检索词", "分类", "内容"];
  const exampleRow = [
    "React 虚拟 DOM 是什么（示例，请删除）",
    "虚拟DOM,diff算法,性能优化",
    "前端/React",
    "虚拟 DOM 是用 JavaScript 对象模拟真实 DOM 树的一种技术，通过对比新旧两棵树的差异，只更新发生变化的部分，从而减少真实 DOM 操作、提升渲染性能。",
  ];

  const worksheet = XLSX.utils.aoa_to_sheet([header, exampleRow]);
  // 设置列宽，方便用户查看长文本
  worksheet["!cols"] = TEMPLATE_COL_WIDTHS.map((wch) => ({ wch }));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "知识条目");

  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

/**
 * 解析上传的 .xlsx 文件为结构化知识条目。
 *
 * @param buffer - 上传文件的二进制内容
 * @returns 解析结果（有效条目 + 失败行汇总）
 * @throws 文件为空 / 无法解析 / 表头缺失「标题」或「内容」列时抛中文错误
 */
export function parseExcel(buffer: Buffer): ExcelParseResult {
  // ---------- 1. 读工作簿 ----------
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error("Excel 文件为空，没有工作表");
  }
  const worksheet = workbook.Sheets[sheetName];

  // 转成二维数组（header:1 表示第一行为表头，defval 用空串避免 undefined）
  const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    defval: "",
  }) as unknown[][];

  if (rows.length === 0) {
    throw new Error("Excel 文件没有内容，请先填写后再上传");
  }

  // ---------- 2. 解析表头，定位列索引 ----------
  const headerRow = rows[0].map((cell) => String(cell ?? "").trim().toLowerCase());
  const colIndex = {
    title: findColumnIndex(headerRow, HEADER_ALIASES.title),
    content: findColumnIndex(headerRow, HEADER_ALIASES.content),
    keywords: findColumnIndex(headerRow, HEADER_ALIASES.keywords),
    category: findColumnIndex(headerRow, HEADER_ALIASES.category),
  };

  // 表头校验：标题、内容列缺失时整体拒绝（不静默入库）
  if (colIndex.title === -1) {
    throw new Error("表头缺失「标题」列，请使用下载的模板或确保首行包含「标题」");
  }
  if (colIndex.content === -1) {
    throw new Error("表头缺失「内容」列，请使用下载的模板或确保首行包含「内容」");
  }

  // ---------- 3. 逐行解析 + 校验 ----------
  const entries: KnowledgeEntry[] = [];
  const failed: { row: number; reason: string }[] = [];
  let total = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    // 取单元格值并规整（兼容数字/空值）
    const title = getCell(row, colIndex.title).trim();
    const content = getCell(row, colIndex.content).trim();
    const keywords = getCell(row, colIndex.keywords).trim();
    const category = getCell(row, colIndex.category).trim();

    // 全空行跳过（不算失败）
    if (!title && !content && !keywords && !category) {
      continue;
    }

    total += 1;
    const rowNo = i + 1; // Excel 行号从 1 开始，且首行是表头，所以数据行号 = i + 1

    // 必填校验：标题
    if (!title) {
      failed.push({ row: rowNo, reason: "标题为空" });
      continue;
    }
    // 必填校验：内容
    if (!content) {
      failed.push({ row: rowNo, reason: "内容为空" });
      continue;
    }

    entries.push({ title, content, keywords, category });
  }

  return { entries, failed, total };
}

/**
 * 在表头数组里查找某个字段对应的列索引。
 *
 * @param headerRow - 已小写化的表头单元格数组
 * @param aliases - 该字段的可识别列名
 * @returns 列索引，找不到返回 -1
 */
function findColumnIndex(headerRow: string[], aliases: string[]): number {
  const normalized = aliases.map((a) => a.toLowerCase());
  return headerRow.findIndex((cell) => normalized.includes(cell));
}

/**
 * 安全读取二维数组某行的单元格值（越界/undefined 返回空串）。
 */
function getCell(row: unknown[], index: number): string {
  if (index < 0 || index >= row.length) {
    return "";
  }
  const value = row[index];
  return value == null ? "" : String(value);
}
