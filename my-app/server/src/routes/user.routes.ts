/**
 * ============================================
 * 用户路由模块（User Routes）
 * ============================================
 *
 * 【API 端点】
 * GET  /api/user/profile   → 获取用户资料（需认证）
 * PUT  /api/user/profile   → 更新用户资料（需认证）
 * PUT  /api/user/password  → 修改密码（需认证）
 * POST /api/user/avatar    → 上传头像（需认证）
 *
 * 所有端点均通过 authMiddleware 保护。
 */

import { Router, type IRouter } from "express";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import { authMiddleware } from "../middleware/auth.js";
import * as userController from "../controllers/user.controller.js";
import * as userService from "../services/user.service.js";

const userRouter: IRouter = Router();

// ============================================================
// 用户资料路由（需认证）
// ============================================================

// 获取用户资料
userRouter.get("/profile", authMiddleware, userController.getProfile);

// 更新用户资料
userRouter.put("/profile", authMiddleware, userController.updateProfile);

// 修改密码
userRouter.put("/password", authMiddleware, userController.changePassword);

// ============================================================
// 头像上传路由（需认证）
// ============================================================

/**
 * multer 文件上传配置
 *
 * - storage: 磁盘存储，保存到 server/uploads/avatars/ 目录
 * - fileFilter: 仅允许图片格式（jpg/jpeg/png/gif/webp）
 * - limits: 限制文件大小 2MB
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const upload = multer({
  storage: multer.diskStorage({
    // 上传文件存储目录（相对于 server/ 根目录）
    destination: path.resolve(__dirname, "../../uploads/avatars"),
    // 文件名：时间戳 + 随机数 + 原始扩展名，确保唯一
    filename(_req, file, cb) {
      const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      const ext = path.extname(file.originalname);
      cb(null, `avatar-${uniqueSuffix}${ext}`);
    },
  }),
  fileFilter(_req, file, cb) {
    // 仅允许图片格式
    const allowedMimes = [
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("仅支持 JPG、PNG、GIF、WebP 格式的图片"));
    }
  },
  limits: {
    fileSize: 2 * 1024 * 1024, // 2MB
  },
});

/**
 * POST /api/user/avatar
 *
 * 上传头像文件。
 * 前端以 multipart/form-data 格式发送，字段名为 avatar。
 *
 * 流程：
 * 1. multer 接收文件 → 保存到 uploads/avatars/
 * 2. 更新数据库中的 avatar 字段
 * 3. 返回头像 URL
 */
userRouter.post(
  "/avatar",
  authMiddleware,
  (req, res, next) => {
    // multer 自带错误处理（文件类型、大小超限等）
    upload.single("avatar")(req, res, (err) => {
      if (err) {
        res.status(400).json({
          success: false,
          message: err.message,
          code: "UPLOAD_ERROR",
        });
        return;
      }
      next();
    });
  },
  async (req, res, next) => {
    try {
      const userId = (req as any).user?.id;
      const file = req.file;

      if (!file) {
        res.status(400).json({
          success: false,
          message: "请选择要上传的头像文件",
        });
        return;
      }

      // 构造头像访问 URL（通过 express.static 暴露 /uploads）
      const avatarUrl = `/uploads/avatars/${file.filename}`;

      // 更新数据库
      const result = await userService.updateAvatar(userId, avatarUrl);

      res.status(200).json({
        success: true,
        message: "头像上传成功",
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
);

export default userRouter;
