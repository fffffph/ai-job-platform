/**
 * ============================================
 * 知识库 MCP Server（独立进程）
 * ============================================
 *
 * 【职责】
 * 以 MCP（Model Context Protocol）协议对外暴露个人知识库能力，
 * 供支持 MCP 的客户端（如 Claude Desktop、Cursor 等）调用。
 *
 * 【启动方式】
 * npm run mcp:dev   →  tsx watch src/ai/tools/mcp/knowledge-server.ts
 * 独立进程，通过 stdio（标准输入输出）与 MCP 客户端通信。
 *
 * 【暴露的工具】
 * - search_knowledge ：检索知识库（向量相似度 Top-K）
 * - list_documents   ：列出知识库文档
 * - add_note         ：新增知识库笔记（分块 + 向量化 + 入库）
 *
 * 【关于 userId 参数】
 * MCP 走 stdio 通道，没有 HTTP 鉴权上下文，无法自动识别用户身份，
 * 因此三个工具都以显式 userId 参数传入，用于按用户隔离知识库。
 *
 * 【dotenv 说明】
 * 本进程由 tsx 直接启动（未带 --env-file），故手动 import "dotenv/config"
 * 加载 .env，保证 DATABASE_URL / SILICONFLOW_API_KEY 等环境变量可用。
 */

import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import prisma from "../../../lib/prisma.js";
import { retrieveChunks } from "../../rag/retrieval/retriever.js";
import { ingestDocument } from "../../rag/ingestion/indexer.js";

/** 创建 MCP Server 实例 */
const server = new McpServer({
  name: "careerai-knowledge",
  version: "1.0.0",
});

/**
 * 把结果序列化为 MCP 工具返回格式（文本 content block）。
 * 显式声明返回类型，确保 type 为字面量 "text"，避免 TS 推断成 string。
 */
function jsonResult(
  data: unknown
): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

/**
 * 工具 1：search_knowledge —— 检索知识库
 * 参数：userId（用户 ID）、query（检索文本）、topK（可选，返回条数）
 */
server.registerTool(
  "search_knowledge",
  {
    title: "搜索个人知识库",
    description:
      "在指定用户的个人知识库中做向量语义检索，返回最相关的文档分块（含来源标题、分块序号、相似度分数）。",
    inputSchema: {
      userId: z.string().describe("用户 ID"),
      query: z.string().describe("检索查询文本"),
      topK: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .describe("返回片段数量，默认 5"),
    },
  },
  async ({ userId, query, topK }) => {
    const chunks = await retrieveChunks(userId, query, topK ?? 5);
    return jsonResult(chunks);
  }
);

/**
 * 工具 2：list_documents —— 列出知识库文档
 * 参数：userId（用户 ID）
 */
server.registerTool(
  "list_documents",
  {
    title: "列出知识库文档",
    description: "列出指定用户知识库中的全部文档（ID、标题、创建时间）。",
    inputSchema: {
      userId: z.string().describe("用户 ID"),
    },
  },
  async ({ userId }) => {
    // Document 模型无 Unsupported 字段，可直接用 Prisma ORM 查询
    const documents = await prisma.document.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true, createdAt: true },
    });
    return jsonResult(documents);
  }
);

/**
 * 工具 3：add_note —— 新增知识库笔记
 * 参数：userId（用户 ID）、title（标题）、content（正文）
 */
server.registerTool(
  "add_note",
  {
    title: "添加知识库笔记",
    description: "将一段文本笔记写入知识库（自动分块 + 向量化 + 入库）。",
    inputSchema: {
      userId: z.string().describe("用户 ID"),
      title: z.string().describe("笔记标题"),
      content: z.string().describe("笔记正文内容"),
    },
  },
  async ({ userId, title, content }) => {
    const result = await ingestDocument(userId, title, content);
    return jsonResult(result);
  }
);

/**
 * 启动 MCP Server。
 * stdio 通道建立后，标准输出 stdout 已被 MCP 协议占用，
 * 因此日志一律走 stderr，避免污染协议消息流。
 */
async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[knowledge-mcp] CareerAI 知识库 MCP Server 已启动");
}

main().catch((error) => {
  console.error("[knowledge-mcp] 启动失败:", error);
  process.exit(1);
});
