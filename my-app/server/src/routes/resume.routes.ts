/**
 * 简历路由（Resume Routes）
 *
 * POST /api/resume/parse    — 解析文件
 * POST /api/resume/optimize — 首轮优化
 * POST /api/resume/chat     — 对话修改
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

// 对话式迭代修改（需认证）
resumeRouter.post("/chat", authMiddleware, resumeController.chatResume);

export default resumeRouter;
