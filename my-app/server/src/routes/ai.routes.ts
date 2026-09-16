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
 * 使用 authMiddleware 保护，只有登录用户才能调用。
 *
 * 【Key 机制】
 * 通过 getDecryptedKey(userId) 按用户隔离读取明文 Key，
 * 无 Key 时返回 403，提示用户先在个人中心配置。
 */

import { Router, type IRouter } from "express";
import type { Request, Response } from "express";
import {
  SystemMessage,
  HumanMessage,
  AIMessage,
} from "@langchain/core/messages";
import { authMiddleware } from "../middleware/auth.js";
import { getDecryptedKey } from "../services/deepseekKey.service.js";
import {
  buildResumeGraph,
  createSSEWriter,
  getTrace,
  clearTrace,
  // 【P3 新增】RAG 相关能力
  ingestDocument,
  buildRagGraph,
  // 【P4 新增】职位发现 Agent 相关能力
  buildJobsGraph,
  JOB_AGENT_SYSTEM_PROMPT,
  // 【P5 新增】用户求职画像（Memory 层）
  getJobProfile,
  saveJobProfile,
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
  // 【P5 新增】用户求职画像类型
  JobProfile,
} from "../ai/index.js";

/** 路由实例 */
const aiRouter: IRouter = Router();

/** 无 Key 时的统一错误提示（与现有 resume 模块文案保持一致） */
const NO_KEY_MESSAGE =
  "需先在个人中心配置 DeepSeek API Key 才能使用 AI 简历分析";

// 【P3 新增】知识库问答的 Key 提示（语义与简历分析略有差异）
const NO_KEY_MESSAGE_KNOWLEDGE =
  "需先在个人中心配置 DeepSeek API Key 才能使用知识库问答";

/** 节点名称 → 中文提示的映射，用于 SSE 的 node 事件 */
const NODE_LABELS: Record<string, string> = {
  parse: "简历解析完成",
  analyze: "AI 结构化分析完成",
  match_assess: "岗位匹配度评估完成",
  suggest: "改进建议汇总完成",
};

/**
 * POST /api/ai/resume/analyze
 *
 * 结构化分析简历（可携带 JD 做匹配度评估），通过 SSE 返回。
 *
 * 请求体：{ "text": "简历文本", "jobDescription": "可选岗位描述" }
 */
aiRouter.post("/resume/analyze", authMiddleware, analyzeResume);

// 【P3 新增】POST /api/ai/knowledge/upload — 上传文档入库（需认证，JSON 返回）
aiRouter.post("/knowledge/upload", authMiddleware, uploadKnowledge);

// 【P3 新增】POST /api/ai/knowledge/ask — 知识库问答（需认证，SSE 返回）
aiRouter.post("/knowledge/ask", authMiddleware, askKnowledge);

// 【P4 新增】POST /api/ai/jobs/recommend — 职位发现 Agent 推荐（需认证，SSE 返回）
aiRouter.post("/jobs/recommend", authMiddleware, recommendJobs);

// 【P5 新增】GET /api/ai/profile — 读取用户求职画像（需认证，JSON 返回）
aiRouter.get("/profile", authMiddleware, getProfile);

// 【P5 新增】PUT /api/ai/profile — 保存用户求职画像（需认证，JSON 返回）
aiRouter.put("/profile", authMiddleware, saveProfile);

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

  // ---------- 阶段 1：读取当前用户 ----------
  const userId = (req as { user?: { id?: string } }).user?.id ?? "";

  if (!userId) {
    res.status(401).json({
      success: false,
      message: "未登录，请先登录",
      code: "UNAUTHORIZED",
    });
    return;
  }

  // ---------- 阶段 1：读取用户级 Key ----------
  let apiKey = "";
  try {
    apiKey = await getDecryptedKey(userId);
  } catch (error) {
    console.error("[AI] 读取 API Key 失败:", (error as Error).message);
    res.status(500).json({
      success: false,
      message: "读取 API Key 失败，请稍后重试",
      code: "KEY_READ_FAILED",
    });
    return;
  }

  if (!apiKey) {
    res.status(403).json({
      success: false,
      message: NO_KEY_MESSAGE,
      code: "DEEPSEEK_KEY_NOT_CONFIGURED",
    });
    return;
  }

  // ---------- 阶段 2：进入 SSE 流式通道 ----------
  const sse = createSSEWriter(res);

  // P1 的 trace 是全局内存单例，开始前清空，避免混入上一轮残留
  clearTrace();

  try {
    // 根据当前用户 Key 构建图（按请求构建，保证 Key 隔离）
    const graph = buildResumeGraph(apiKey);

    const initialState: ResumeState = {
      resumeText: text,
      jobDescription,
      analysis: null,
      match: null,
      suggestions: [],
      messages: [],
    };

    // 通知客户端开始执行 + 当前阶段提示
    sse.send("meta", {
      type: "start",
      message: "开始分析简历",
      hasJobDescription: Boolean(jobDescription),
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

        sse.send("node", nodeData);
      }
    }

    // 附带节点级 trace 事件 + 完成事件（含完整结构化结果）
    sse.send("trace", { events: getTrace() });
    sse.send("done", {
      success: true,
      message: "分析完成",
      analysis: finalAnalysis,
      match: finalMatch,
      suggestions: finalSuggestions,
    });
  } catch (error) {
    const message = (error as Error).message || "AI 分析失败";
    console.error("[AI] 简历分析失败:", message);
    sse.send("error", { success: false, message });
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
  const userId = (req as { user?: { id?: string } }).user?.id ?? "";
  if (!userId) {
    res.status(401).json({
      success: false,
      message: "未登录，请先登录",
      code: "UNAUTHORIZED",
    });
    return;
  }

  // ---------- 入库（分块 + 向量化 + 写 pgvector） ----------
  try {
    const result = await ingestDocument(userId, title, content);
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
 * 【P3 新增】POST /api/ai/knowledge/ask
 *
 * 知识库问答：检索相关知识 → LLM 增强生成 → 带引用返回，通过 SSE 返回。
 *
 * 请求体：{ "question": "用户问题" }
 *
 * SSE 事件流（P3）：
 *   meta  → 开始执行
 *   node  → retrieve 完成（含 chunks 检索结果）
 *   node  → generate 完成（含 answer 带引用回答）
 *   trace → 节点级 trace 事件
 *   done  → 完成（含 answer + chunks）
 *   error → 出错
 */
async function askKnowledge(req: Request, res: Response): Promise<void> {
  // ---------- 阶段 1：参数校验 ----------
  const body = (req.body ?? {}) as { question?: unknown };
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

  // ---------- 阶段 1：读取当前用户 ----------
  const userId = (req as { user?: { id?: string } }).user?.id ?? "";
  if (!userId) {
    res.status(401).json({
      success: false,
      message: "未登录，请先登录",
      code: "UNAUTHORIZED",
    });
    return;
  }

  // ---------- 阶段 1：读取用户级 DeepSeek Key（answer 节点使用） ----------
  let apiKey = "";
  try {
    apiKey = await getDecryptedKey(userId);
  } catch (error) {
    console.error("[AI] 读取 API Key 失败:", (error as Error).message);
    res.status(500).json({
      success: false,
      message: "读取 API Key 失败，请稍后重试",
      code: "KEY_READ_FAILED",
    });
    return;
  }

  if (!apiKey) {
    res.status(403).json({
      success: false,
      message: NO_KEY_MESSAGE_KNOWLEDGE,
      code: "DEEPSEEK_KEY_NOT_CONFIGURED",
    });
    return;
  }

  // ---------- 阶段 2：进入 SSE 流式通道 ----------
  const sse = createSSEWriter(res);
  clearTrace();

  try {
    // 根据当前用户 Key 构建 RAG 图（按请求构建，保证 Key 隔离）
    const graph = buildRagGraph(apiKey);

    const initialState: RAGState = {
      question,
      userId,
      chunks: [],
      answer: "",
    };

    // 通知客户端开始执行
    sse.send("meta", {
      type: "start",
      message: "开始知识库检索问答",
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
          sse.send("node", {
            nodeName: "generate",
            done: true,
            message: "带引用回答生成完成",
            answer: finalAnswer,
          });
        }
      }
    }

    // 附带节点级 trace 事件 + 完成事件（含完整结果）
    sse.send("trace", { events: getTrace() });
    sse.send("done", {
      success: true,
      message: "回答完成",
      answer: finalAnswer,
      chunks: finalChunks,
    });
  } catch (error) {
    const message = (error as Error).message || "知识库问答失败";
    console.error("[AI] 知识库问答失败:", message);
    sse.send("error", { success: false, message });
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
  const userId = (req as { user?: { id?: string } }).user?.id ?? "";
  if (!userId) {
    res.status(401).json({
      success: false,
      message: "未登录，请先登录",
      code: "UNAUTHORIZED",
    });
    return;
  }

  // ---------- 阶段 1：读取用户级 DeepSeek Key ----------
  let apiKey = "";
  try {
    apiKey = await getDecryptedKey(userId);
  } catch (error) {
    console.error("[AI] 读取 API Key 失败:", (error as Error).message);
    res.status(500).json({
      success: false,
      message: "读取 API Key 失败，请稍后重试",
      code: "KEY_READ_FAILED",
    });
    return;
  }

  if (!apiKey) {
    res.status(403).json({
      success: false,
      message: "需先在个人中心配置 DeepSeek API Key 才能使用职位推荐",
      code: "DEEPSEEK_KEY_NOT_CONFIGURED",
    });
    return;
  }

  // ---------- 阶段 1：解析求职意向 ----------
  const body = (req.body ?? {}) as {
    city?: unknown;
    skills?: unknown;
    expectedSalary?: unknown;
  };
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
  clearTrace();

  try {
    // 组装求职意向描述（作为 HumanMessage 注入 Agent 上下文）
    const intentParts: string[] = [];
    if (skills) intentParts.push(`技能栈：${skills}`);
    if (city) intentParts.push(`期望城市：${city}`);
    if (expectedSalary) intentParts.push(`期望薪资：${expectedSalary}`);
    const intent =
      intentParts.length > 0
        ? `我的求职意向如下：\n${intentParts.join("\n")}\n\n请帮我搜索并推荐匹配的职位。`
        : "请帮我搜索并推荐合适的前端开发职位。";

    // 初始消息流：系统 Prompt + 用户求职意向
    const initialState: JobsState = {
      messages: [
        new SystemMessage(JOB_AGENT_SYSTEM_PROMPT),
        new HumanMessage(intent),
      ],
    };

    // 通知客户端开始执行
    sse.send("meta", { type: "start", message: "开始职位发现" });

    // 根据当前用户 Key 构建 ReAct 图（按请求构建，保证 Key 隔离）
    const graph = buildJobsGraph(apiKey);

    // ReAct 循环为非流式（需完整 AIMessage 判断 tool_calls），用 updates 模式
    const stream = await graph.stream(initialState, {
      streamMode: "updates",
    });

    let finalAnswer = "";

    for await (const updates of stream) {
      const updateMap = updates as Record<string, Partial<JobsState>>;

      for (const [nodeName, update] of Object.entries(updateMap)) {
        if (nodeName === "agent") {
          // agent 节点：推送本轮决策结果（调用工具 / 给出回答）
          const newMessages = update.messages ?? [];
          const lastMsg = newMessages[newMessages.length - 1] as
            | AIMessage
            | undefined;
          const hasToolCalls =
            lastMsg instanceof AIMessage && (lastMsg.tool_calls?.length ?? 0) > 0;

          sse.send("node", {
            nodeName: "agent",
            done: true,
            message: hasToolCalls ? "Agent 正在搜索职位…" : "Agent 已完成推荐",
            action: hasToolCalls ? "call_tools" : "answer",
          });

          if (!hasToolCalls && lastMsg) {
            finalAnswer =
              typeof lastMsg.content === "string" ? lastMsg.content : "";
          }
        } else if (nodeName === "tools") {
          sse.send("node", {
            nodeName: "tools",
            done: true,
            message: "已获取职位数据",
          });
        }
      }
    }

    // 附带节点级 trace 事件 + 完成事件（含最终推荐）
    sse.send("trace", { events: getTrace() });
    sse.send("done", {
      success: true,
      message: "职位推荐完成",
      answer: finalAnswer,
    });

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
  const userId = (req as { user?: { id?: string } }).user?.id ?? "";
  if (!userId) {
    res.status(401).json({ success: false, message: "未登录", code: "UNAUTHORIZED" });
    return;
  }

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
  const userId = (req as { user?: { id?: string } }).user?.id ?? "";
  if (!userId) {
    res.status(401).json({ success: false, message: "未登录", code: "UNAUTHORIZED" });
    return;
  }

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

export default aiRouter;
