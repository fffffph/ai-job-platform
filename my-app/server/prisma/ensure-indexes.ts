/**
 * ============================================
 * 数据库结构兜底脚本（db push 无法表达的对象）
 * ============================================
 *
 * 【为什么需要这个脚本】
 * 项目用 `prisma db push` 同步 schema（无 migrations 目录），
 * 但 Prisma schema 的 @unique 只能生成「大小写敏感」的普通唯一索引，
 * 无法表达「函数式唯一索引」（lower(email) 这种）。
 *
 * 应用层虽然把所有写库路径（注册/新增用户/编辑用户/改标识）都做了
 * 「转小写归一化」，但那是软约束、靠纪律。一旦未来新增的写库路径、
 * 批量导入、或手工 SQL 漏了归一化，就会写入 "Admin" 和 "admin" 两个
 * 账号；而登录时 resolveIdentifier 统一转小写查库，会导致 "Admin"
 * 永远登不进去，变成一个「既占坑、又找不回」的死账号。
 *
 * 因此把「大小写不敏感唯一」下沉为数据库硬约束：
 *   lower(email) 唯一、lower(username) 唯一。
 *
 * 【运行方式】
 *   npm run db:indexes
 *   或：npx tsx --env-file=.env prisma/ensure-indexes.ts
 *
 * 【幂等性】
 * 全部用 CREATE UNIQUE INDEX IF NOT EXISTS，可重复执行。
 * 环境重建（db push / migrate reset / 换新库）后，记得重新跑一次。
 *
 * 【为什么 phone 不在这里处理】
 * phone 的归一化是「去分隔符只留数字」（如 "138 0000 0000" → "13800000000"），
 * 这是正则替换，无法用 SQL 表达式简单表达，故保持现状，靠应用层纪律 + @unique。
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// ========== 创建适配器与独立客户端（与 seed.ts 同款做法）==========
const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL || "",
});

const prisma = new PrismaClient({
  adapter,
  log: ["error", "warn"],
});

async function main() {
  console.log("\n🔧 确保数据库函数式唯一索引存在...\n");

  // 邮箱：大小写不敏感唯一（lower(email)）
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "users_email_lower"
       ON "users" (lower("email"))
       WHERE "email" IS NOT NULL`
  );
  console.log("✅ users_email_lower（邮箱大小写不敏感唯一）");

  // 用户名：大小写不敏感唯一（lower(username)）
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "users_username_lower"
       ON "users" (lower("username"))
       WHERE "username" IS NOT NULL`
  );
  console.log("✅ users_username_lower（用户名大小写不敏感唯一）");

  console.log("\n🎉 完成。");
}

main()
  .catch((e) => {
    console.error("❌ 执行失败：", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
