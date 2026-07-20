/**
 * ============================================
 * 认证路由模块（Auth Routes）
 * ============================================
 *
 * 【职责】
 * 定义与用户认证相关的 API 路径和 HTTP 方法，
 * 将请求路由到对应的控制器处理函数。
 *
 * 【API 端点一览】
 * POST /api/auth/register  → 用户注册（创建新账号）
 * POST /api/auth/login     → 用户登录（返回 JWT Token）
 *
 * 【路由挂载方式】
 * 在 app.ts 中挂载：
 * app.use("/api/auth", authRoutes);
 *
 * 完整请求路径 = 挂载路径 + 路由定义路径
 * 例如：/api/auth + /login = POST /api/auth/login
 */

import { Router, type IRouter } from "express";
import * as authController from "../controllers/auth.controller.js";

/**
 * 创建 Express Router 实例
 *
 * Router 是一个迷你版的 Express 应用，可以独立定义路由和中间件，
 * 然后挂载到主应用的某个路径前缀下。
 * 显式标注 IRouter 类型以避免 pnpm 路径推导错误（TS2742）。
 */
const authRouter: IRouter = Router();

// ============================================================
// 路由定义
// ============================================================

/**
 * POST /api/auth/register
 *
 * 用户注册接口
 * 接收邮箱、密码、姓名字段，创建新用户并返回 JWT Token
 */
authRouter.post("/register", authController.register);

/**
 * POST /api/auth/login
 *
 * 用户登录接口
 * 接收邮箱、密码，验证通过后返回 JWT Token
 */
authRouter.post("/login", authController.login);

export default authRouter;
