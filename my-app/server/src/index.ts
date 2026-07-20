/**
 * ============================================
 * 服务器启动入口（Index）
 * ============================================
 *
 * 【职责】
 * - 启动 HTTP 服务器
 * - 优雅关闭处理
 *
 * 【环境变量加载说明】
 * 【重要】.env 文件的加载不在这里完成！
 *
 * 在 package.json 的 dev 脚本中使用了 Node 20+ 的 --env-file 标志：
 *   "dev": "tsx watch --env-file=.env src/index.ts"
 *
 * 这样 .env 中的环境变量会在 Node 进程启动前加载完毕，
 * 解决了 ES Module 导入提升（hoisting）导致的 dotenv 加载顺序问题。
 *
 * 【为什么不使用 import "dotenv/config"？】
 * ES Module 中所有 import 语句会被静态提升到文件顶部执行，
 * 即使源代码中 `import "dotenv/config"` 写在最前面，
 * 它仍然会在 `import app from "./app.js"` 之后才执行（取决于模块图）。
 * 这会导致 app.ts 内部的 Prisma 客户端构造时读不到环境变量。
 *
 * 【启动流程】
 * 1. Node 进程启动，加载 .env 环境变量
 * 2. tsx 加载并编译 TypeScript
 * 3. 导入 app 实例
 * 4. 监听端口启动 HTTP 服务器
 * 5. 注册进程信号处理（SIGTERM / SIGINT），实现优雅关闭
 *
 * 【运行方式】
 * 开发：npm run dev  （内部调用 tsx --env-file=.env src/index.ts）
 * 构建：npm run build（编译 ts → js 到 dist/）
 * 生产：npm start    （内部调用 node --env-file=.env dist/index.js）
 */

import app from "./app.js";
import { createServer } from "http";

// ============================================================
// 端口配置
// ============================================================

/**
 * 从环境变量读取端口号，默认 4000
 * 4000 端口避免与 Next.js（3000）和 Vite 子应用（3001）冲突
 */
const PORT = parseInt(process.env.PORT || "4000", 10);

// ============================================================
// 启动服务器
// ============================================================

const server = createServer(app);

server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════╗
║       🚀 CareerAI API 服务已启动             ║
╠══════════════════════════════════════════════╣
║  端口      : ${PORT}                            ║
║  环境      : ${process.env.NODE_ENV || "development"}                      ║
║  健康检查  : http://localhost:${PORT}/api/health  ║
║  API 文档  : http://localhost:${PORT}/api/auth   ║
║                                              ║
║  接口列表：                                  ║
║  POST /api/auth/register  — 用户注册         ║
║  POST /api/auth/login     — 用户登录         ║
║  GET  /api/health         — 健康检查         ║
╚══════════════════════════════════════════════╝
  `);
});

// ============================================================
// 优雅关闭（Graceful Shutdown）
// ============================================================

/**
 * 监听进程终止信号，优雅关闭服务器。
 *
 * 当收到 SIGTERM（kill 命令）或 SIGINT（Ctrl+C）时：
 * 1. 停止接收新的请求
 * 2. 等待当前正在处理的请求完成
 * 3. 关闭数据库连接（Prisma 自动管理连接池，无需手动断开）
 * 4. 退出进程
 *
 * 如果不做优雅关闭，正在处理的请求会被强制中断，
 * 可能导致数据不一致或用户收到 502 错误。
 */
process.on("SIGTERM", () => {
  console.log("[服务器] 收到 SIGTERM 信号，正在关闭...");
  server.close(() => {
    console.log("[服务器] HTTP 服务器已关闭");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("[服务器] 收到 SIGINT 信号（Ctrl+C），正在关闭...");
  server.close(() => {
    console.log("[服务器] HTTP 服务器已关闭");
    process.exit(0);
  });
});
