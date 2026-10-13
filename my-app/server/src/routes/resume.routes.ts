/**
 * 简历路由（Resume Routes）
 *
 * POST /api/resume/parse           — 解析文件（无需认证）
 * POST /api/resume/optimize        — 首轮优化（JSON 一次性返回，保留兼容）
 * POST /api/resume/optimize-stream — 首轮优化（SSE，深度思考过程逐字下发）
 * POST /api/resume/chat            — 对话修改
 *
 * 【为什么 optimize 与 optimize-stream 并存】
 * 流式版是新增能力，独立路径可以做到零破坏：旧前端构建（或第三方调用方）
 * 仍能继续用 JSON 版；待前端全部切换后再考虑下线旧接口。
 */

import { Router, type IRouter } from "express";
import multer from "multer";
import { authMiddleware } from "../middleware/auth.js";
import * as resumeController from "../controllers/resume.controller.js";

const resumeRouter: IRouter = Router();

/**
 * multipart/form-data 文件上传中间件
 *
 * 使用内存存储（不对文件做持久化），buffer 直接传 service 解析。
 * 限制 10MB，防止超大文件耗尽内存。
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// 解析简历文件
resumeRouter.post(
  "/parse",
  upload.single("file"),
  resumeController.parseResume
);

// 首轮 AI 优化（需认证，按用户隔离读取密钥）
resumeRouter.post("/optimize", authMiddleware, resumeController.optimizeResume);

// 首轮 AI 优化 · 流式版（需认证，SSE 返回，思考过程逐字下发）
resumeRouter.post(
  "/optimize-stream",
  authMiddleware,
  resumeController.streamOptimize
);

// 多轮对话修改 · 流式版（需认证，SSE 返回，思考过程逐字下发）
resumeRouter.post(
  "/chat-stream",
  authMiddleware,
  resumeController.streamChat
);

// 对话式迭代修改（需认证）
resumeRouter.post("/chat", authMiddleware, resumeController.chatResume);

export default resumeRouter;
