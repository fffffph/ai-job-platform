/**
 * ============================================
 * AI 路由（AI Routes）
 * ============================================
 *
 * 【职责】
 * 暴露 AI 相关的 HTTP 接口。
 *
 * P1 接口：
 * - POST /api/ai/resume/analyze — AI 流式分析简历（需认证，SSE 返回）
 *
 * P2 接口：
 * - POST /api/ai/resume/analyze — AI 结构化分析简历（需认证，SSE 返回）
 *   请求体新增可选字段 jobDescription，用于岗位匹配度评估。
 *
 * P3 接口：
 * - POST /api/ai/knowledge/upload — 上传知识库文档（需认证，JSON 返回）
 * - POST /api/ai/knowledge/ask   — 知识库问答（需认证，SSE 返回）
 *
 * 【SSE 事件流（P2 简历分析）】
 *   meta     → 开始执行（含 hasJobDescription 标记）
 *   progress → 提示当前阶段（正在分析 / 正在匹配）
 *   node     → 节点完成，携带该节点的结构化结果
 *   trace    → 节点级 trace 事件（供 AI Trace 面板）
 *   done     → 完成（含 analysis / match / suggestions）
 *   error    → 出错
 *   （P2 去掉了纯文本 token 逐字流，结构化输出改为节点完成时推送）
 *
 * 【认证】
 * 本文件所有接口均需登录，统一在文件顶部挂一次 authMiddleware
 * （aiRouter.use），不再逐个路由重复声明，杜绝漏挂；
 * 各 handler 内用 requireUser(req, res) 取 userId —— 一次调用同时完成
 * 「类型收窄」与「401 兜底」，401 响应体全项目只维护一份。
 *
 * 【Key 机制】
 * 通过 loadUserKeyOrFail(userId, res, message) 按用户隔离读取明文 Key：
 * 读取失败 → 500，用户未配置 → 403（提示先在个人中心配置）。
 * 该辅助函数收敛了原本次散落在 4 个接口里的同款错误分支。
 */

import { Router, type IRouter } from "express";
import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import {
  SystemMessage,
  HumanMessage,
  AIMessage,
} from "@langchain/core/messages";
import { authMiddleware, requireUser } from "../middleware/auth.js";
import { loadUserKeyOrFail } from "../middleware/userKey.js";
import { getDecryptedKey } from "../services/deepseekKey.service.js";
import multer from "multer";
import {
  buildResumeGraph,
  createSSEWriter,
  runWithTrace,
  saveTraceRun,
  listTraceRuns,
  getTraceRun,
  // 【P3 新增】RAG 相关能力
  ingestDocument,
  buildRagGraph,
  // 【P4 新增】职位发现 Agent 相关能力
  buildJobsGraph,
  // 【P5 新增】用户求职画像（Memory 层）
  getJobProfile,
  saveJobProfile,
  // 【知识库文件解析】Excel 解析 + 模板 + 文件真相源 + 批量入库
  parseExcel,
  buildTemplate,
  ingestEntries,
  saveKnowledgeFile,
  getKnowledgeFile,
  getKnowledgeFileInfo,
  deleteKnowledgeFile,
  // 【知识库文件解析】文档管理（列表/删除）
  listDocuments,
  deleteDocument,
  // 【知识库文件解析】文本解析（规则 + LLM 兜底）
  parseTextToEntries,
  parseTextWithLLM,
} from "../ai/index.js";
import type {
  ResumeState,
  ResumeAnalysis,
  MatchResult,
  // 【P3 新增】RAG 状态与检索结果类型
  RAGState,
  RetrievedChunk,
  // 【P4 新增】职位发现状态类型
  JobsState,
  // 【P4 新增】职位推荐结构化输出类型
  JobRecommendation,
  // 【P5 新增】用户求职画像类型
  JobProfile,
  // 【知识库文件解析】Excel 解析结果类型
  ExcelParseResult,
  // 【P6 新增】trace 事件类型（落库辅助函数签名用）
  TraceEvent,
} from "../ai/index.js";
// 【P3 参数收敛】配置装配层：从配置中心读取并组装各 AI 图的 options
import {
  loadResumeGraphOptions,
  loadRagGraphOptions,
  loadJobsGraphOptions,
  loadRagIngestOptions,
  loadParseTextOptions,
} from "../config/ai-config.js";
// 【P5 开关】直接读取功能开关（文本解析 LLM 兜底开关）
import { getConfig } from "../config/config-service.js";

/** 路由实例 */
const aiRouter: IRouter = Router();

/** 无 Key 时的统一错误提示（与现有 resume 模块文案保持一致） */
const NO_KEY_MESSAGE =
  "需先在个人中心配置 DeepSeek API Key 才能使用 AI 简历分析";

// 【P3 新增】知识库问答的 Key 提示（语义与简历分析略有差异）
const NO_KEY_MESSAGE_KNOWLEDGE =
  "需先在个人中心配置 DeepSeek API Key 才能使用知识库问答";

// 【P4 新增】职位推荐的 Key 提示
const NO_KEY_MESSAGE_JOBS =
  "需先在个人中心配置 DeepSeek API Key 才能使用职位推荐";

// 【知识库文件解析】文本 AI 解析的 Key 提示（仅 LLM 兜底分支需要）
const NO_KEY_MESSAGE_PARSE_TEXT =
  "需先在个人中心配置 DeepSeek API Key 才能使用 AI 智能解析";

/** 知识库 Excel 上传中间件（内存存储，限制 10MB，防止超大文件耗尽内存） */
const knowledgeUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

/**
 * 【P6 新增】trace 落库的安全封装。
 *
 * 落库是「可观测性」的辅助能力，绝不允许因落库失败影响主流程：
 * 任何异常都只 console.warn 告警，不向上抛出、不打断 SSE 响应。
 */
async function saveTraceRunSafely(
  runId: string,
  userId: string,
  type: "resume" | "rag" | "jobs",
  status: "success" | "error",
  events: TraceEvent[]
): Promise<void> {
  try {
    await saveTraceRun({ runId, userId, type, status, events });
  } catch (error) {
    console.warn("[AI-Trace] 落库失败:", (error as Error).message);
  }
}

/**
 * 读取当前用户的明文 DeepSeek Key。
 *
 * 已抽到 middleware/userKey.ts 统一维护（简历的流式接口也要用），
 * 本文件直接 import 使用。
 */

/** 节点名称 → 中文提示的映射，用于 SSE 的 node 事件 */
const NODE_LABELS: Record<string, string> = {
  parse: "简历解析完成",
  analyze: "AI 结构化分析完成",
  match_assess: "岗位匹配度评估完成",
  suggest: "改进建议汇总完成",
};

// ============================================================
// 认证前置：本文件所有接口均需登录
// ============================================================

/**
 * 统一挂一次 authMiddleware，而不是在 16 个路由上各写一遍。
 *
 * 好处：
 * 1. 新增路由自动受保护，不存在「写了路由忘挂中间件」的漏网可能；
 * 2. 认证入口唯一，排查「这个接口到底要不要登录」只需看这一行。
 *
 * 注意：Express 的中间件按注册顺序生效，因此本行必须在下面所有路由之前。
 */
aiRouter.use(authMiddleware);

// ============================================================
// 路由定义
// ============================================================

/**
 * POST /api/ai/resume/analyze
 *
 * 结构化分析简历（可携带 JD 做匹配度评估），通过 SSE 返回。
 *
 * 请求体：{ "text": "简历文本", "jobDescription": "可选岗位描述" }
 */
aiRouter.post("/resume/analyze", analyzeResume);

// 【P3 新增】POST /api/ai/knowledge/upload — 上传文档入库（JSON 返回）
aiRouter.post("/knowledge/upload", uploadKnowledge);

// 【P3 新增】POST /api/ai/knowledge/ask — 知识库问答（SSE 返回）
aiRouter.post("/knowledge/ask", askKnowledge);

// 【知识库文件解析】GET /api/ai/knowledge/template — 下载导入模板
aiRouter.get("/knowledge/template", downloadTemplate);

// 【知识库文件解析】GET /api/ai/knowledge/file — 下载上次上传的原始文件
aiRouter.get("/knowledge/file", downloadKnowledgeFile);

// 【知识库文件解析】GET /api/ai/knowledge/file-info — 查询文件元信息
aiRouter.get("/knowledge/file-info", getFileInfo);

// 【知识库文件解析】DELETE /api/ai/knowledge/file — 删除保存的原始文件记录
aiRouter.delete("/knowledge/file", deleteFileInfo);

// 【知识库文件解析】POST /api/ai/knowledge/import — 上传 Excel 解析入库
aiRouter.post(
  "/knowledge/import",
  knowledgeUpload.single("file"),
  importKnowledge
);

// 【知识库文件解析】GET /api/ai/knowledge/documents — 列出知识条目
aiRouter.get("/knowledge/documents", listKnowledgeDocuments);

// 【知识库文件解析】DELETE /api/ai/knowledge/documents/:id — 删除知识条目
aiRouter.delete("/knowledge/documents/:id", deleteKnowledgeDocument);

// 【知识库文件解析】POST /api/ai/knowledge/parse-text — 文本解析成条目
aiRouter.post("/knowledge/parse-text", parseTextKnowledge);

// 【知识库文件解析】POST /api/ai/knowledge/batch — JSON 数组批量入库
aiRouter.post("/knowledge/batch", batchImportKnowledge);

// 【P4 新增】POST /api/ai/jobs/recommend — 职位发现 Agent 推荐（SSE 返回）
aiRouter.post("/jobs/recommend", recommendJobs);

// 【P5 新增】GET /api/ai/profile — 读取用户求职画像（JSON 返回）
aiRouter.get("/profile", getProfile);

// 【P5 新增】PUT /api/ai/profile — 保存用户求职画像（JSON 返回）
aiRouter.put("/profile", saveProfile);

// 【P6 新增】GET /api/ai/trace/runs — 列出用户最近的 AI 执行记录（JSON 返回）
aiRouter.get("/trace/runs", listTraceRunRecords);

// 【P6 新增】GET /api/ai/trace/runs/:id — 查询单次执行的完整决策过程（JSON 返回）
aiRouter.get("/trace/runs/:id", getTraceRunRecord);

/**
 * 简历结构化分析处理器。
 *
 * 分成两个阶段：
 * 1. 校验阶段（尚未写响应头）：参数 / 登录 / Key 校验失败时直接返回 JSON 错误；
 * 2. 流式阶段（已写响应头）：错误只能通过 SSE 的 error 事件告知客户端。
 */
async function analyzeResume(req: Request, res: Response): Promise<void> {
  // ---------- 阶段 1：参数校验 ----------
  const body = (req.body ?? {}) as {
    text?: unknown;
    jobDescription?: unknown;
    thinking?: unknown;
  };
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const jobDescription =
    typeof body.jobDescription === "string" ? body.jobDescription.trim() : "";

  if (!text) {
    res.status(400).json({
      success: false,
      message: "请提供简历文本内容",
      code: "INVALID_RESUME_TEXT",
    });
    return;
  }

  // 会话级思考开关：严格等于 true 才算开启（可选增强项，传错值不报 400）
  const requestThinking = body.thinking === true;

  // ---------- 阶段 1：读取当前用户 ----------
  const userId = requireUser(req, res);
  if (!userId) return;

  // ---------- 阶段 1：读取用户级 Key ----------
  const apiKey = await loadUserKeyOrFail(userId, res, NO_KEY_MESSAGE);
  if (!apiKey) return;

  // ---------- 阶段 2：进入 SSE 流式通道 ----------
  const sse = createSSEWriter(res);

  // 【P6】本次执行的唯一 ID（用于 trace 落库 + 历史回放）
  const runId = randomUUID();

  try {
    // 【P6】用 runWithTrace 包裹整段图执行：ALS 隔离收集节点级 trace 事件
    const { result, events } = await runWithTrace(runId, async () => {
      // 根据当前用户 Key 构建图（按请求构建，保证 Key 隔离），
      // 模型参数与 Prompt 由配置中心注入（P3 参数收敛）；
      // 思考开关的最终判定（全局熔断 ∩ 会话级）在装配层完成
      const graphOptions = await loadResumeGraphOptions({
        thinking: requestThinking,
      });
      const graph = buildResumeGraph(apiKey, graphOptions);

      const initialState: ResumeState = {
        resumeText: text,
        jobDescription,
        analysis: null,
        match: null,
        suggestions: [],
        messages: [],
        reasoning: "",
        reasoningMs: 0,
      };

      // 通知客户端开始执行 + 当前阶段提示
      sse.send("meta", {
        type: "start",
        message: "开始分析简历",
        hasJobDescription: Boolean(jobDescription),
        // 【深度思考】告知前端本次是否开启思考（前端据此决定是否展示思考面板）
        thinking: {
          enabled: graphOptions.thinking === true,
          effort: graphOptions.reasoningEffort ?? "high",
        },
      });
      sse.send("progress", {
        stage: "analyze",
        message: jobDescription
          ? "正在分析简历并评估岗位匹配度…"
          : "正在分析简历…",
      });

      // 结构化输出为非流式，只用 updates 模式取节点完成时的结构化结果
      const stream = await graph.stream(initialState, {
        streamMode: "updates",
      });

      // 记录最终完整结果（从各节点 update 中取）
      let finalAnalysis: ResumeAnalysis | null = null;
      let finalMatch: MatchResult | null = null;
      let finalSuggestions: string[] = [];

      for await (const updates of stream) {
        const updateMap = updates as Record<string, Partial<ResumeState>>;

        for (const [nodeName, update] of Object.entries(updateMap)) {
          // 组装 node 事件，携带该节点的结构化结果
          const nodeData: Record<string, unknown> = {
            nodeName,
            done: true,
            message: NODE_LABELS[nodeName] ?? `节点 ${nodeName} 完成`,
          };

          if (nodeName === "analyze") {
            nodeData.analysis = update.analysis ?? null;
            finalAnalysis = update.analysis ?? null;
          } else if (nodeName === "match_assess") {
            nodeData.match = update.match ?? null;
            finalMatch = update.match ?? null;
          } else if (nodeName === "suggest") {
            nodeData.suggestions = update.suggestions ?? [];
            finalSuggestions = update.suggestions ?? [];
          }

          // 【深度思考】先推思考过程，再推节点结果。
          // 顺序保证前端状态单向流转（停止计时 → 展示思考 → 渲染结果），
          // 不会出现「结果先出来、思考块再补上」的跳变。
          // suggest 节点无 LLM，reasoning 为空自然跳过。
          const reasoning = update.reasoning ?? "";
          if (reasoning) {
            sse.send("reasoning", {
              nodeName,
              content: reasoning,
              reasoningMs: update.reasoningMs ?? 0,
            });
            // 该节点确实思考过：把耗时一并带进 node 事件，供 Trace 面板展示
            nodeData.reasoningMs = update.reasoningMs ?? 0;
          }

          sse.send("node", nodeData);
        }
      }

      return { finalAnalysis, finalMatch, finalSuggestions };
    });

    // 附带节点级 trace 事件 + 完成事件（含完整结构化结果）
    sse.send("trace", { events });
    sse.send("done", {
      success: true,
      message: "分析完成",
      analysis: result.finalAnalysis,
      match: result.finalMatch,
      suggestions: result.finalSuggestions,
    });

    // 【P6】trace 落库（成功状态）
    await saveTraceRunSafely(runId, userId, "resume", "success", events);
  } catch (error) {
    const message = (error as Error).message || "AI 分析失败";
    console.error("[AI] 简历分析失败:", message);
    sse.send("error", { success: false, message });
    // 【P6】trace 落库（失败状态，无事件）
    await saveTraceRunSafely(runId, userId, "resume", "error", []);
  } finally {
    // 无论成功失败都关闭 SSE 流，避免连接挂起
    sse.close();
  }
}

/**
 * 【P3 新增】POST /api/ai/knowledge/upload
 *
 * 上传知识库文档（P3 仅支持纯文本 content），分块 + 向量化后入库。
 * 无需用户级 DeepSeek Key（embedding 用服务端级 SiliconFlow Key）。
 *
 * 请求体：{ "title": "文档标题", "content": "文档全文" }
 * 响应体：{ "success": true, "message": "...", "data": { "documentId": "...", "chunkCount": 3 } }
 * 【修复】documentId/chunkCount 统一包装进 data 字段，与其他接口的
 * { success, message, data } 响应格式保持一致（此前放在顶层导致前端
 * res.data 为 undefined，读取 chunkCount 报 TypeError）
 */
async function uploadKnowledge(req: Request, res: Response): Promise<void> {
  // ---------- 参数校验 ----------
  const body = (req.body ?? {}) as { title?: unknown; content?: unknown };
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const content = typeof body.content === "string" ? body.content.trim() : "";

  if (!title) {
    res.status(400).json({
      success: false,
      message: "请提供文档标题",
      code: "INVALID_DOCUMENT_TITLE",
    });
    return;
  }
  if (!content) {
    res.status(400).json({
      success: false,
      message: "请提供文档内容",
      code: "INVALID_DOCUMENT_CONTENT",
    });
    return;
  }

  // ---------- 读取当前用户 ----------
  const userId = requireUser(req, res);
  if (!userId) return;

  // ---------- 入库（分块 + 向量化 + 写 pgvector） ----------
  try {
    // 分块大小/重叠/Embedding 超时由配置中心注入（P3 参数收敛）
    const result = await ingestDocument(
      userId,
      title,
      content,
      undefined,
      undefined,
      await loadRagIngestOptions()
    );
    // 【修复】统一包装进 data 字段，与 ApiResponse<UploadResult> 类型约定一致
    res.json({
      success: true,
      message: "文档入库成功",
      data: result,
    });
  } catch (error) {
    const message = (error as Error).message || "文档入库失败";
    console.error("[AI] 知识库文档入库失败:", message);
    res.status(500).json({
      success: false,
      message,
      code: "INGEST_FAILED",
    });
  }
}

/**
 * 【知识库文件解析】GET /api/ai/knowledge/template
 *
 * 下载知识库导入模板 .xlsx（表头：标题/检索词/分类/内容 + 示例行）。
 * 首次使用时前端引导用户下载，用户本地维护一份文件反复上传。
 */
async function downloadTemplate(_req: Request, res: Response): Promise<void> {
  const buffer = buildTemplate();
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="knowledge-template.xlsx"'
  );
  res.send(buffer);
}

/**
 * 【知识库文件解析】GET /api/ai/knowledge/file
 *
 * 下载用户上次上传的原始 Excel 文件（「文件真相源」），
 * 用户在此基础上增删改后再上传，避免「重下空模板导致旧知识丢失」。
 */
async function downloadKnowledgeFile(
  req: Request,
  res: Response
): Promise<void> {
  const userId = requireUser(req, res);
  if (!userId) return;

  const file = await getKnowledgeFile(userId);
  if (!file) {
    res.status(404).json({
      success: false,
      message: "尚未上传过文件，请先下载模板填写后上传",
      code: "NO_FILE",
    });
    return;
  }

  const downloadName = /\.xlsx?$/i.test(file.filename)
    ? file.filename
    : `${file.filename}.xlsx`;
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  // filename 作兜底，filename* 用 UTF-8 编码支持中文文件名
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="knowledge.xlsx"; filename*=UTF-8''${encodeURIComponent(downloadName)}`
  );
  res.send(file.content);
}

/**
 * 【知识库文件解析】GET /api/ai/knowledge/file-info
 *
 * 查询用户上传文件的元信息（轻量，不含字节），
 * 前端据此判断「显示下载模板引导」还是「显示文件卡片」。
 */
async function getFileInfo(req: Request, res: Response): Promise<void> {
  const userId = requireUser(req, res);
  if (!userId) return;

  try {
    const info = await getKnowledgeFileInfo(userId);
    res.json({
      success: true,
      message: "查询成功",
      data: info
        ? { hasFile: true, filename: info.filename, updatedAt: info.updatedAt }
        : { hasFile: false },
    });
  } catch (error) {
    const message = (error as Error).message || "查询文件信息失败";
    console.error("[AI] 查询文件信息失败:", message);
    res.status(500).json({ success: false, message, code: "FILE_INFO_FAILED" });
  }
}

/**
 * 【知识库文件解析】DELETE /api/ai/knowledge/file
 *
 * 删除保存的原始文件记录（只删文件真相源，不动已入库的知识）。
 * 删除后前端回到「下载模板」引导状态。
 */
async function deleteFileInfo(req: Request, res: Response): Promise<void> {
  const userId = requireUser(req, res);
  if (!userId) return;

  try {
    const deleted = await deleteKnowledgeFile(userId);
    res.json({
      success: true,
      message: deleted ? "文件已删除" : "暂无保存的文件",
    });
  } catch (error) {
    const message = (error as Error).message || "删除文件失败";
    console.error("[AI] 删除文件失败:", message);
    res.status(500).json({ success: false, message, code: "FILE_DELETE_FAILED" });
  }
}

/**
 * 【知识库文件解析】POST /api/ai/knowledge/import
 *
 * 上传 Excel → 解析 → 校验 → 批量入库（replace/append）→ 保存原始文件。
 * 请求体：multipart/form-data，file 字段 + mode 字段（replace/append）。
 */
async function importKnowledge(req: Request, res: Response): Promise<void> {
  // ---------- 1. 用户校验 ----------
  const userId = requireUser(req, res);
  if (!userId) return;

  // ---------- 2. 文件校验（multer 无文件 / 非 xlsx） ----------
  const file = (req as { file?: Express.Multer.File }).file;
  if (!file) {
    res.status(400).json({
      success: false,
      message: "请上传 Excel 文件",
      code: "NO_FILE",
    });
    return;
  }
  const filename = file.originalname || "knowledge.xlsx";
  if (!/\.xlsx?$/i.test(filename)) {
    res.status(400).json({
      success: false,
      message: "仅支持 .xlsx 文件，请使用下载的模板",
      code: "INVALID_FILE_TYPE",
    });
    return;
  }

  // mode 参数（multipart 文本字段，默认 replace=同步替换）
  const mode: "replace" | "append" =
    (req.body as { mode?: unknown })?.mode === "append" ? "append" : "replace";

  // ---------- 3. 解析 + 校验 ----------
  let parseResult: ExcelParseResult;
  try {
    parseResult = parseExcel(file.buffer);
  } catch (error) {
    const message = (error as Error).message || "Excel 解析失败";
    res.status(400).json({ success: false, message, code: "PARSE_FAILED" });
    return;
  }

  // 无有效条目：直接拒绝，绝不触发 replace 清空旧知识
  if (parseResult.entries.length === 0) {
    res.status(400).json({
      success: false,
      message: parseResult.failed.length
        ? `文件中没有有效知识条目，共 ${parseResult.failed.length} 行校验失败`
        : "文件中没有有效知识条目",
      code: "NO_VALID_ENTRIES",
      data: parseResult,
    });
    return;
  }

  // ---------- 4. 批量入库 + 保存原始文件 ----------
  try {
    // 分块大小/重叠/Embedding 超时由配置中心注入（P3 参数收敛）
    const result = await ingestEntries(
      userId,
      parseResult.entries,
      mode,
      await loadRagIngestOptions()
    );
    await saveKnowledgeFile(userId, filename, file.buffer);

    res.json({
      success: true,
      message: mode === "replace" ? "同步替换成功" : "追加入库成功",
      data: {
        documentCount: result.documentCount,
        chunkCount: result.chunkCount,
        total: parseResult.total,
        failed: parseResult.failed,
      },
    });
  } catch (error) {
    const message = (error as Error).message || "知识入库失败";
    console.error("[AI] 知识库批量入库失败:", message);
    res.status(500).json({ success: false, message, code: "INGEST_FAILED" });
  }
}

/**
 * 【知识库文件解析】GET /api/ai/knowledge/documents
 *
 * 列出当前用户的所有知识库文档（标题/分类/检索词/分块数/入库时间），
 * 供「我的知识」列表展示。
 */
async function listKnowledgeDocuments(
  req: Request,
  res: Response
): Promise<void> {
  const userId = requireUser(req, res);
  if (!userId) return;

  try {
    const documents = await listDocuments(userId);
    res.json({ success: true, message: "查询成功", data: documents });
  } catch (error) {
    const message = (error as Error).message || "查询知识库失败";
    console.error("[AI] 查询知识库文档失败:", message);
    res.status(500).json({ success: false, message, code: "LIST_FAILED" });
  }
}

/**
 * 【知识库文件解析】DELETE /api/ai/knowledge/documents/:id
 *
 * 删除单条知识文档（仅限本人，级联删除其 chunks）。
 */
async function deleteKnowledgeDocument(
  req: Request,
  res: Response
): Promise<void> {
  const userId = requireUser(req, res);
  const documentId = (req.params as { id?: string })?.id ?? "";

  if (!userId) return;
  if (!documentId) {
    res.status(400).json({
      success: false,
      message: "缺少文档 ID",
      code: "INVALID_ID",
    });
    return;
  }

  try {
    const deleted = await deleteDocument(userId, documentId);
    if (!deleted) {
      res.status(404).json({
        success: false,
        message: "文档不存在或无权删除",
        code: "NOT_FOUND",
      });
      return;
    }
    res.json({ success: true, message: "删除成功" });
  } catch (error) {
    const message = (error as Error).message || "删除失败";
    console.error("[AI] 删除知识库文档失败:", message);
    res.status(500).json({ success: false, message, code: "DELETE_FAILED" });
  }
}

/**
 * 【知识库文件解析】POST /api/ai/knowledge/parse-text
 *
 * 把用户粘贴的文本解析成结构化知识条目。
 * 先规则解析（免费）；规则解析无结果且 useLLM=true 时用 LLM 兜底解析。
 *
 * 请求体：{ "text": "粘贴的文本", "useLLM": true }
 * 响应体：{ success, data: { entries, needLLM } }
 */
async function parseTextKnowledge(req: Request, res: Response): Promise<void> {
  const userId = requireUser(req, res);
  if (!userId) return;

  const body = (req.body ?? {}) as { text?: unknown; useLLM?: unknown };
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const useLLM = body.useLLM === true;

  if (!text) {
    res.status(400).json({
      success: false,
      message: "请粘贴要解析的文本",
      code: "INVALID_TEXT",
    });
    return;
  }

  // ---------- 1. 规则解析（免费） ----------
  let entries = parseTextToEntries(text);

  // 【P5 开关】读取「文本解析 LLM 兜底」开关：关闭时即使前端勾选 AI 解析，
  // 也强制跳过 LLM 兜底（省 token），只走规则解析。
  let llmParseEnabled = true;
  try {
    llmParseEnabled = await getConfig<boolean>("switch.llm_parse");
  } catch (error) {
    console.warn("[AI] 读取文本解析 LLM 兜底开关失败:", (error as Error).message);
  }

  // ---------- 2. 规则解析无结果且允许 LLM → 兜底 ----------
  if (entries.length === 0 && useLLM && llmParseEnabled) {
    const apiKey = await loadUserKeyOrFail(userId, res, NO_KEY_MESSAGE_PARSE_TEXT);
    if (!apiKey) return;

    try {
      // 解析 Prompt 与模型参数由配置中心注入（P3 参数收敛）
      entries = await parseTextWithLLM(text, apiKey, await loadParseTextOptions());
    } catch (error) {
      const message = (error as Error).message || "AI 解析失败";
      console.error("[AI] 文本 AI 解析失败:", message);
      res.status(502).json({
        success: false,
        message,
        code: "PARSE_LLM_FAILED",
      });
      return;
    }
  }

  // ---------- 3. 仍无结果 → 提示可开启 AI 解析（开关关闭时提示系统已禁用） ----------
  if (entries.length === 0) {
    res.json({
      success: true,
      message: llmParseEnabled
        ? "未识别到结构化条目，可尝试勾选「AI 智能解析」"
        : "未识别到结构化条目，且系统已关闭「AI 智能解析」",
      data: { entries: [], needLLM: llmParseEnabled },
    });
    return;
  }

  res.json({
    success: true,
    message: `解析出 ${entries.length} 条知识`,
    data: { entries, needLLM: false },
  });
}

/**
 * 【知识库文件解析】POST /api/ai/knowledge/batch
 *
 * JSON 数组批量入库（文本解析确认后调用）。
 * 请求体：{ "entries": [{ title, content, keywords?, category? }], "mode": "replace" | "append" }
 */
async function batchImportKnowledge(
  req: Request,
  res: Response
): Promise<void> {
  const userId = requireUser(req, res);
  if (!userId) return;

  const body = (req.body ?? {}) as { entries?: unknown; mode?: unknown };
  const rawEntries = Array.isArray(body.entries) ? body.entries : [];
  const mode: "replace" | "append" =
    body.mode === "append" ? "append" : "replace";

  // 规整条目：只保留 title/content 为字符串的合法条目
  const entries = rawEntries
    .map((e) => e as Record<string, unknown>)
    .filter(
      (e) =>
        typeof e?.title === "string" &&
        (e.title as string).trim() &&
        typeof e?.content === "string" &&
        (e.content as string).trim()
    )
    .map((e) => ({
      title: (e.title as string).trim(),
      content: (e.content as string).trim(),
      keywords: typeof e.keywords === "string" ? (e.keywords as string).trim() : undefined,
      category: typeof e.category === "string" ? (e.category as string).trim() : undefined,
    }));

  if (entries.length === 0) {
    res.status(400).json({
      success: false,
      message: "没有可入库的有效条目",
      code: "NO_VALID_ENTRIES",
    });
    return;
  }

  try {
    // 分块大小/重叠/Embedding 超时由配置中心注入（P3 参数收敛）
    const result = await ingestEntries(
      userId,
      entries,
      mode,
      await loadRagIngestOptions()
    );
    res.json({
      success: true,
      message: mode === "replace" ? "同步替换成功" : "追加入库成功",
      data: {
        documentCount: result.documentCount,
        chunkCount: result.chunkCount,
      },
    });
  } catch (error) {
    const message = (error as Error).message || "知识入库失败";
    console.error("[AI] 批量入库失败:", message);
    res.status(500).json({ success: false, message, code: "INGEST_FAILED" });
  }
}

/**
 * 【P3 新增】POST /api/ai/knowledge/ask
 *
 * 知识库问答：检索相关知识 → LLM 增强生成 → 带引用返回，通过 SSE 返回。
 *
 * 请求体：{ "question": "用户问题", "thinking"?: true }
 *
 * SSE 事件流（P3）：
 *   meta      → 开始执行（含 thinking 标记：本次是否开启深度思考）
 *   node      → retrieve 完成（含 chunks 检索结果）
 *   reasoning → generate 的思考过程（含 content 思考全文 + reasoningMs 耗时）
 *   node      → generate 完成（含 answer 带引用回答、reasoningMs）
 *   trace     → 节点级 trace 事件
 *   done      → 完成（含 answer + chunks）
 *   error     → 出错
 *
 * 【深度思考（P1）】
 * - 顺序：reasoning 事件先于对应的 node 事件下发，保证前端状态流转是单向的
 *   （停止计时 → 展示思考 → 渲染答案），不会出现答案先出来、思考块再补上的跳变；
 * - 开关：请求体 thinking 为「会话级」意图，还需通过配置项
 *   switch.deep_thinking 的全局熔断，二者都满足才会真正思考（见 ai-config.ts）；
 * - meta 事件会把最终判定结果回给前端，前端不必自己推断，避免前后端判定不一致。
 */
async function askKnowledge(req: Request, res: Response): Promise<void> {
  // ---------- 阶段 1：参数校验 ----------
  const body = (req.body ?? {}) as { question?: unknown; thinking?: unknown };
  const question =
    typeof body.question === "string" ? body.question.trim() : "";

  if (!question) {
    res.status(400).json({
      success: false,
      message: "请提供问题",
      code: "INVALID_QUESTION",
    });
    return;
  }

  // 会话级思考开关：只有严格等于 true 才算开启，其余（未传/false/字符串）一律视为不开启。
  // 这里不做 400 报错：开关是可选增强项，传错值不该让整次问答失败。
  const requestThinking = body.thinking === true;

  // ---------- 阶段 1：读取当前用户 ----------
  const userId = requireUser(req, res);
  if (!userId) return;

  // ---------- 阶段 1：读取用户级 DeepSeek Key（answer 节点使用） ----------
  const apiKey = await loadUserKeyOrFail(userId, res, NO_KEY_MESSAGE_KNOWLEDGE);
  if (!apiKey) return;

  // ---------- 阶段 2：进入 SSE 流式通道 ----------
  const sse = createSSEWriter(res);

  // 【P6】本次执行的唯一 ID（用于 trace 落库 + 历史回放）
  const runId = randomUUID();

  try {
    // 【P6】用 runWithTrace 包裹整段图执行：ALS 隔离收集节点级 trace 事件
    const { result, events } = await runWithTrace(runId, async () => {
      // 根据当前用户 Key 构建 RAG 图（按请求构建，保证 Key 隔离），
      // 模型/检索参数/Prompt 由配置中心注入（P3 参数收敛）；
      // 思考开关的最终判定（全局熔断 ∩ 会话级）在装配层完成
      const graphOptions = await loadRagGraphOptions({
        thinking: requestThinking,
      });
      const graph = buildRagGraph(apiKey, graphOptions);

      const initialState: RAGState = {
        question,
        userId,
        chunks: [],
        answer: "",
        reasoning: "",
        reasoningMs: 0,
      };

      // 通知客户端开始执行
      sse.send("meta", {
        type: "start",
        message: "开始知识库检索问答",
        // 【深度思考】告知前端本次是否开启思考，前端据此决定要不要展示思考面板；
        // 开启时前端会立即启动本地计时器，让用户"感觉到它在思考"
        thinking: {
          enabled: graphOptions.thinking === true,
          effort: graphOptions.reasoningEffort ?? "high",
        },
      });

      // 结构化输出为非流式，只用 updates 模式取节点完成时的结构化结果
      const stream = await graph.stream(initialState, {
        streamMode: "updates",
      });

      let finalChunks: RetrievedChunk[] = [];
      let finalAnswer = "";

      for await (const updates of stream) {
        const updateMap = updates as Record<string, Partial<RAGState>>;

        for (const [nodeName, update] of Object.entries(updateMap)) {
          if (nodeName === "retrieve") {
            finalChunks = update.chunks ?? [];
            sse.send("node", {
              nodeName: "retrieve",
              done: true,
              message: "知识库检索完成",
              chunks: finalChunks,
            });
          } else if (nodeName === "generate") {
            // 【P3 修正】节点名为 generate（图内避免与 state 字段 answer 冲突）
            finalAnswer = update.answer ?? "";
            const reasoning = update.reasoning ?? "";
            const reasoningMs = update.reasoningMs ?? 0;

            // 【深度思考】先推思考过程，再推回答。
            // 以「思考文本是否为空」作为是否真的思考过的判据：
            // 关闭思考时模型不会返回 reasoning_content，也就不会打扰前端。
            if (reasoning) {
              sse.send("reasoning", {
                nodeName: "generate",
                content: reasoning,
                reasoningMs,
              });
            }

            sse.send("node", {
              nodeName: "generate",
              done: true,
              message: "带引用回答生成完成",
              answer: finalAnswer,
              // 仅在真的思考过时附带耗时，避免前端把普通生成误显示成"深度思考"
              ...(reasoning ? { reasoningMs } : {}),
            });
          }
        }
      }

      return { finalChunks, finalAnswer };
    });

    // 附带节点级 trace 事件 + 完成事件（含完整结果）
    sse.send("trace", { events });
    sse.send("done", {
      success: true,
      message: "回答完成",
      answer: result.finalAnswer,
      chunks: result.finalChunks,
    });

    // 【P6】trace 落库（成功状态）
    await saveTraceRunSafely(runId, userId, "rag", "success", events);
  } catch (error) {
    const message = (error as Error).message || "知识库问答失败";
    console.error("[AI] 知识库问答失败:", message);
    sse.send("error", { success: false, message });
    // 【P6】trace 落库（失败状态，无事件）
    await saveTraceRunSafely(runId, userId, "rag", "error", []);
  } finally {
    // 无论成功失败都关闭 SSE 流，避免连接挂起
    sse.close();
  }
}

/**
 * 【P4 新增】POST /api/ai/jobs/recommend
 *
 * 职位发现 Agent 推荐：LLM 自主规划搜索策略，ReAct 循环调用 search_jobs
 * 工具探索职位库，最终输出带理由的个性化职位推荐，通过 SSE 返回。
 *
 * 请求体：{ "city"?: "西安", "skills"?: "React,TypeScript", "expectedSalary"?: "12k-18k" }
 *
 * SSE 事件流（P4）：
 *   meta  → 开始执行
 *   node  → agent 决策完成（含本轮是「调用工具」还是「给出回答」）
 *   node  → tools 工具执行完成
 *   trace → 节点级 trace 事件（完整还原 Agent 决策过程）
 *   done  → 完成（含 answer 最终推荐文本）
 *   error → 出错
 */
async function recommendJobs(req: Request, res: Response): Promise<void> {
  // ---------- 阶段 1：读取当前用户 ----------
  const userId = requireUser(req, res);
  if (!userId) return;

  // ---------- 阶段 1：读取用户级 DeepSeek Key ----------
  const apiKey = await loadUserKeyOrFail(userId, res, NO_KEY_MESSAGE_JOBS);
  if (!apiKey) return;

  // ---------- 阶段 1：解析求职意向 ----------
  const body = (req.body ?? {}) as {
    city?: unknown;
    skills?: unknown;
    expectedSalary?: unknown;
    thinking?: unknown;
  };

  // 会话级思考开关：严格等于 true 才算开启（可选增强项，传错值不报 400）
  const requestThinking = body.thinking === true;
  let city = typeof body.city === "string" ? body.city.trim() : "";
  let skills = typeof body.skills === "string" ? body.skills.trim() : "";
  let expectedSalary =
    typeof body.expectedSalary === "string" ? body.expectedSalary.trim() : "";

  // 【P5 新增】画像兜底：请求未传的字段，用已保存的求职画像补充（跨轮记忆）
  try {
    const profile = await getJobProfile(userId);
    if (profile) {
      if (!city) city = profile.city;
      if (!skills) skills = profile.skills;
      if (!expectedSalary) expectedSalary = profile.expectedSalary;
    }
  } catch (error) {
    // 画像读取失败不影响推荐主流程，仅告警
    console.warn("[AI] 读取求职画像失败:", (error as Error).message);
  }

  // ---------- 阶段 2：进入 SSE 流式通道 ----------
  const sse = createSSEWriter(res);

  // 【P6】本次执行的唯一 ID（用于 trace 落库 + 历史回放）
  const runId = randomUUID();

  try {
    // 【P6】用 runWithTrace 包裹整段图执行：ALS 隔离收集节点级 trace 事件
    const { result, events } = await runWithTrace(runId, async () => {
      // 【P3 参数收敛】读取职位发现配置：模型/推荐参数 + 模板化 Agent 人设 Prompt；
      // 思考开关的最终判定（全局熔断 ∩ 会话级）在装配层完成
      const { graph: jobsGraphOptions, jobAgentPrompt } =
        await loadJobsGraphOptions({ thinking: requestThinking });

      // 组装求职意向描述（作为 HumanMessage 注入 Agent 上下文）
      const intentParts: string[] = [];
      if (skills) intentParts.push(`技能栈：${skills}`);
      if (city) intentParts.push(`期望城市：${city}`);
      if (expectedSalary) intentParts.push(`期望薪资：${expectedSalary}`);
      const intent =
        intentParts.length > 0
          ? `我的求职意向如下：\n${intentParts.join("\n")}\n\n请帮我搜索并推荐匹配的职位。`
          : "请帮我搜索并推荐合适的前端开发职位。";

      // 初始消息流：系统 Prompt（模板化）+ 用户求职意向
      const initialState: JobsState = {
        messages: [
          new SystemMessage(jobAgentPrompt),
          new HumanMessage(intent),
        ],
        recommendations: null,
        reasoning: "",
        reasoningMs: 0,
      };

      // 通知客户端开始执行
      sse.send("meta", {
        type: "start",
        message: "开始职位发现",
        // 【深度思考】告知前端本次是否开启思考（前端据此决定是否展示思考面板）
        thinking: {
          enabled: jobsGraphOptions.thinking === true,
          effort: jobsGraphOptions.reasoningEffort ?? "high",
        },
      });

      // 根据当前用户 Key 构建 ReAct 图（按请求构建，保证 Key 隔离），
      // 传入用户画像供 finalize 节点做个性化结构化推荐，模型/推荐参数由配置注入
      const graph = buildJobsGraph(apiKey, {
        ...jobsGraphOptions,
        profile: { city, skills, expectedSalary },
      });

      // ReAct 循环为非流式（需完整 AIMessage 判断 tool_calls），用 updates 模式
      const stream = await graph.stream(initialState, {
        streamMode: "updates",
      });

      let finalRecommendation: JobRecommendation | null = null;

      for await (const updates of stream) {
        const updateMap = updates as Record<string, Partial<JobsState>>;

        for (const [nodeName, update] of Object.entries(updateMap)) {
          // 【深度思考】先推本轮的思考过程，再推节点结果。
          // ReAct 循环里 agent 会执行多轮，因此前端应把多个 reasoning 事件
          // 累积成列表展示，而不是只保留最后一个。
          // tools 节点无 LLM，reasoning 为空自然跳过。
          const reasoning = update.reasoning ?? "";
          const reasoningMs = update.reasoningMs ?? 0;
          if (reasoning) {
            sse.send("reasoning", {
              nodeName,
              content: reasoning,
              reasoningMs,
            });
          }

          if (nodeName === "agent") {
            // agent 节点：推送本轮决策结果（调用工具 / 结束搜索）
            const newMessages = update.messages ?? [];
            const lastMsg = newMessages[newMessages.length - 1] as
              | AIMessage
              | undefined;
            const hasToolCalls =
              lastMsg instanceof AIMessage && (lastMsg.tool_calls?.length ?? 0) > 0;

            sse.send("node", {
              nodeName: "agent",
              done: true,
              message: hasToolCalls ? "Agent 正在搜索职位…" : "搜索完成，正在生成推荐…",
              action: hasToolCalls ? "call_tools" : "answer",
              // 仅在本轮真的思考过时带上耗时
              ...(reasoning ? { reasoningMs } : {}),
            });
          } else if (nodeName === "tools") {
            sse.send("node", {
              nodeName: "tools",
              done: true,
              message: "已获取职位数据",
            });
          } else if (nodeName === "finalize") {
            // finalize 节点：结构化推荐结果（含推荐原因/招呼语/直达链接）
            finalRecommendation = update.recommendations ?? null;
            sse.send("node", {
              nodeName: "finalize",
              done: true,
              message: "推荐生成完成",
              recommendationCount:
                finalRecommendation?.recommendations.length ?? 0,
              ...(reasoning ? { reasoningMs } : {}),
            });
          }
        }
      }

      return { finalRecommendation };
    });

    // 附带节点级 trace 事件 + 完成事件（含结构化推荐）
    sse.send("trace", { events });
    sse.send("done", {
      success: true,
      message: "职位推荐完成",
      recommendations: result.finalRecommendation,
    });

    // 【P6】trace 落库（成功状态）
    await saveTraceRunSafely(runId, userId, "jobs", "success", events);

    // 【P5 新增】推荐结束后自动保存求职画像（跨轮记忆更新）
    // 仅在用户本次提供了至少一个字段时写入；失败静默降级，不影响已成功的推荐
    if (city || skills || expectedSalary) {
      try {
        await saveJobProfile(userId, { city, skills, expectedSalary });
      } catch (error) {
        console.warn("[AI] 保存求职画像失败:", (error as Error).message);
      }
    }
  } catch (error) {
    const message = (error as Error).message || "职位推荐失败";
    console.error("[AI] 职位推荐失败:", message);
    sse.send("error", { success: false, message });
    // 【P6】trace 落库（失败状态，无事件）
    await saveTraceRunSafely(runId, userId, "jobs", "error", []);
  } finally {
    // 无论成功失败都关闭 SSE 流，避免连接挂起
    sse.close();
  }
}

/**
 * 【P5 新增】GET /api/ai/profile
 *
 * 读取当前用户的求职画像（结构化记忆）。
 *
 * 响应体：{ "success": true, "data": { "jobTitle","city","skills","expectedSalary" } }
 * 未设置过画像时 data 为 null。
 */
async function getProfile(req: Request, res: Response): Promise<void> {
  const userId = requireUser(req, res);
  if (!userId) return;

  try {
    const profile = await getJobProfile(userId);
    res.json({ success: true, data: profile });
  } catch (error) {
    const message = (error as Error).message || "读取求职画像失败";
    console.error("[AI] 读取求职画像失败:", message);
    res.status(500).json({ success: false, message, code: "PROFILE_READ_FAILED" });
  }
}

/**
 * 【P5 新增】PUT /api/ai/profile
 *
 * 保存当前用户的求职画像（合并更新：只更新传入的非空字段）。
 *
 * 请求体：{ "jobTitle"?, "city"?, "skills"?, "expectedSalary"? }
 * 响应体：{ "success": true, "data": 保存后的完整画像 }
 */
async function saveProfile(req: Request, res: Response): Promise<void> {
  const userId = requireUser(req, res);
  if (!userId) return;

  const body = (req.body ?? {}) as {
    jobTitle?: unknown;
    city?: unknown;
    skills?: unknown;
    expectedSalary?: unknown;
  };

  // 仅取字符串字段，非字符串/空值忽略（合并更新语义）
  const profile: Partial<JobProfile> = {};
  if (typeof body.jobTitle === "string") profile.jobTitle = body.jobTitle.trim();
  if (typeof body.city === "string") profile.city = body.city.trim();
  if (typeof body.skills === "string") profile.skills = body.skills.trim();
  if (typeof body.expectedSalary === "string") {
    profile.expectedSalary = body.expectedSalary.trim();
  }

  try {
    const saved = await saveJobProfile(userId, profile);
    res.json({ success: true, message: "求职画像已保存", data: saved });
  } catch (error) {
    const message = (error as Error).message || "保存求职画像失败";
    console.error("[AI] 保存求职画像失败:", message);
    res.status(500).json({ success: false, message, code: "PROFILE_SAVE_FAILED" });
  }
}

/**
 * 【P6 新增】GET /api/ai/trace/runs
 *
 * 列出当前用户最近的 AI 执行记录（不含事件详情，轻量分页）。
 * 用于「AI 决策历史」列表，让用户看到每次 AI 执行的时间/类型/耗时。
 *
 * 响应体：{ success, data: [{ id, type, status, nodeCount, totalDurationMs, createdAt }] }
 */
async function listTraceRunRecords(req: Request, res: Response): Promise<void> {
  const userId = requireUser(req, res);
  if (!userId) return;

  try {
    const runs = await listTraceRuns(userId);
    res.json({ success: true, message: "查询成功", data: runs });
  } catch (error) {
    const message = (error as Error).message || "查询 trace 记录失败";
    console.error("[AI-Trace] 查询记录失败:", message);
    res.status(500).json({ success: false, message, code: "TRACE_LIST_FAILED" });
  }
}

/**
 * 【P6 新增】GET /api/ai/trace/runs/:id
 *
 * 查询单次 AI 执行的完整决策过程（含按顺序排列的节点事件）。
 * 用于「回放」某次 AI 的每一步决策（输入/输出/耗时/时间戳）。
 *
 * 响应体：{ success, data: { id, type, status, ..., events: [...] } }
 */
async function getTraceRunRecord(req: Request, res: Response): Promise<void> {
  const userId = requireUser(req, res);
  const runId = (req.params as { id?: string })?.id ?? "";

  if (!userId) return;
  if (!runId) {
    res.status(400).json({ success: false, message: "缺少 run ID", code: "INVALID_ID" });
    return;
  }

  try {
    const run = await getTraceRun(userId, runId);
    if (!run) {
      res.status(404).json({
        success: false,
        message: "记录不存在或无权访问",
        code: "NOT_FOUND",
      });
      return;
    }
    res.json({ success: true, message: "查询成功", data: run });
  } catch (error) {
    const message = (error as Error).message || "查询 trace 详情失败";
    console.error("[AI-Trace] 查询详情失败:", message);
    res.status(500).json({ success: false, message, code: "TRACE_GET_FAILED" });
  }
}

export default aiRouter;
