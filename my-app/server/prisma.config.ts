/**
 * ============================================
 * Prisma 配置文件（Prisma 7）
 * ============================================
 *
 * 【用途】
 * 为 Prisma CLI 命令（migrate、db push、generate）提供数据库连接配置。
 *
 * 【Prisma 7 关键变更】
 * - datasource 块从 schema.prisma 中独立出来
 * - 必须在配置文件中使用单数 `datasource`（不是 `datasources`）
 * - `datasource.url` 是唯一必需的连接配置
 * - 必须在文件顶部加载 dotenv（导入 dotenv/config），
 *   这样 env() 才能读取到 .env 中的值
 *
 * @see https://pris.ly/d/config-datasource
 */

// ⚠️ 必须在所有其他导入之前加载 dotenv
// 这样后续代码（包括 env()）才能读到 .env 中的变量
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  // Schema 文件路径
  schema: "prisma/schema.prisma",

  // 数据源配置（Prisma 7 格式：单数 datasource）
  datasource: {
    // 使用 env() 辅助函数从环境变量读取，缺失时会抛错
    url: env("DATABASE_URL"),
  },

  // 迁移相关配置
  migrations: {
    // 迁移文件输出目录
    path: "prisma/migrations",
    // 数据库种子脚本（运行 prisma db seed 时执行）
    seed: "tsx prisma/seed.ts",
  },
});
