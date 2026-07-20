/**
 * ============================================
 * Prisma 客户端单例模块（Prisma 7）
 * ============================================
 *
 * 【Prisma 7 重要变更】
 * Prisma 7 不再支持通过 datasourceUrl 直接连接数据库。
 * 必须使用驱动适配器（Driver Adapter）来连接 PostgreSQL。
 * 本项目使用官方推荐的 @prisma/adapter-pg 适配器。
 *
 * 【驱动适配器原理】
 * Prisma 7 引入了"驱动适配器"模式：
 * - 传统模式：Prisma 内部管理数据库连接（rust 引擎）
 * - 新模式：使用 Node.js 生态的数据库驱动（如 pg）作为适配器
 *
 * 这种模式的好处：
 * 1. 与 Serverless 环境更兼容（无连接池泄漏问题）
 * 2. 与 Edge 运行时兼容（如 Cloudflare Workers、Vercel Edge）
 * 3. 可以复用现有的数据库连接池
 *
 * 【为什么需要单例？】
 * 每次热重载都可能创建新的 PrismaClient 实例。
 * 过多的数据库连接会导致 "Too many connections" 错误。
 * 单例模式确保整个应用中只有一个 PrismaClient 实例。
 *
 * 【使用方式】
 * import prisma from "../lib/prisma.js";
 * const user = await prisma.user.findUnique({ where: { email } });
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * 创建 PostgreSQL 驱动适配器
 *
 * PrismaPg 接收连接配置对象，支持以下字段：
 * - connectionString: 完整的 PostgreSQL 连接 URL
 * - 或者 host/port/user/password/database 单独配置
 */
const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL || "",
});

/**
 * 创建 PrismaClient 实例
 *
 * Prisma 7 强制要求传入 adapter 或 accelerateUrl 选项。
 * PrismaClient 会通过适配器与数据库通信，而不是内置的 rust 引擎。
 */
const prisma = new PrismaClient({
  /**
   * 驱动适配器（Prisma 7 必需）
   *
   * 传入上面创建的 PrismaPg 实例，PrismaClient 会通过它连接 PostgreSQL。
   */
  adapter,

  /**
   * 日志配置
   *
   * 开发环境下启用 query 日志，方便调试 SQL 语句。
   * 生产环境建议改为 ['error'] 或 ['warn']，减少日志输出。
   */
  log:
    process.env.NODE_ENV === "development"
      ? ["query", "error", "warn"]
      : ["error"],
});

export default prisma;
