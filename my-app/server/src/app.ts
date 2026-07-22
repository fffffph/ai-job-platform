/**
 * ============================================
 * Express 应用配置模块（App）
 * ============================================
 *
 * 【职责】
 * 1. 创建 Express 应用实例
 * 2. 注册全局中间件（CORS、JSON 解析等）
 * 3. 挂载路由模块
 * 4. 注册全局错误处理
 *
 * 【注意】
 * 本文件只负责应用的创建和配置，不启动服务器。
 * 服务器启动逻辑在 index.ts 中，这样分离便于测试。
 */

import express, { type Express } from "express";
import path from "path";
import { fileURLToPath } from "url";
import cors from "cors";
import authRouter from "./routes/auth.routes.js";
import userRouter from "./routes/user.routes.js";
import { errorHandler } from "./middleware/errorHandler.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ============================================================
// 创建 Express 应用
// ============================================================
/**
 * 显式标注 Express 类型，避免 pnpm 路径推导错误（TS2742）
 */
const app: Express = express();

// ============================================================
// 全局中间件注册（执行顺序 = 注册顺序）
// ============================================================

/**
 * 1. CORS 跨域中间件
 *
 * 允许前端应用（Next.js :3000 / Vite :3001）跨域访问后端 API。
 * 开发环境下允许所有来源，生产环境应限制为前端域名。
 */
app.use(
  cors({
    // 允许的前端地址（开发环境）
    origin: [
      "http://localhost:3000", // Next.js 主应用
      "http://localhost:3001", // Vite 子应用
    ],
    // 允许的 HTTP 方法
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    // 允许的请求头
    allowedHeaders: ["Content-Type", "Authorization"],
    // 允许携带 Cookie（如果前端使用 cookie 存储 token）
    credentials: true,
  })
);

/**
 * 2. 静态文件服务
 *
 * 将 uploads 目录作为静态资源暴露，前端通过 /uploads/avatars/xxx.jpg 访问上传的头像。
 * 必须在其他中间件之前注册，避免被 JSON 解析拦截。
 */
app.use(
  "/uploads",
  express.static(path.resolve(__dirname, "../uploads"))
);

/**
 * 3. JSON 请求体解析
 *
 * 自动将 Content-Type: application/json 的请求体解析为 JS 对象。
 * 解析后的数据挂载在 req.body 上。
 */
app.use(express.json());

/**
 * 4. URL-encoded 请求体解析
 *
 * 解析 Content-Type: application/x-www-form-urlencoded 的请求体。
 * extended: true 表示使用 qs 库解析嵌套对象。
 */
app.use(express.urlencoded({ extended: true }));

// ============================================================
// 路由挂载
// ============================================================

/**
 * 健康检查路由
 *
 * 用于监控服务是否正常运行（如 Docker health check、负载均衡器探测）。
 * 访问 GET /api/health → 200 OK
 */
app.get("/api/health", (_req, res) => {
  res.json({
    success: true,
    message: "CareerAI API 服务运行正常",
    timestamp: new Date().toISOString(),
  });
});

/**
 * 认证路由
 *
 * 所有 /api/auth/* 路径的请求都交给 authRouter 处理。
 * 具体路由定义在 routes/auth.routes.ts 中：
 * - POST /api/auth/register
 * - POST /api/auth/login
 */
app.use("/api/auth", authRouter);

/**
 * 用户路由
 *
 * 所有 /api/user/* 路径的请求都交给 userRouter 处理。
 * 具体路由定义在 routes/user.routes.ts 中：
 * - GET  /api/user/profile  — 获取用户资料（需认证）
 * - PUT  /api/user/profile  — 更新用户资料（需认证）
 * - PUT  /api/user/password — 修改密码（需认证）
 * - POST /api/user/avatar   — 上传头像（需认证）
 */
app.use("/api/user", userRouter);

// ============================================================
// 全局错误处理
// ============================================================

/**
 * 必须在所有路由之后注册！
 *
 * Express 中间件的执行顺序是：
 * 1. 全局中间件（cors、json 等）
 * 2. 路由中间件（匹配到的路由处理器）
 * 3. 错误处理中间件（当 next(error) 被调用时）
 *
 * 如果错误处理中间件在路由之前注册，不会被触发。
 */
app.use(errorHandler);

// ============================================================
// 导出
// ============================================================
export default app;
