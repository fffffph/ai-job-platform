/**
 * ============================================
 * 数据库种子文件（Seed）
 * ============================================
 *
 * 【用途】
 * 向数据库中插入初始测试数据，方便开发和测试。
 *
 * 【运行方式】
 * npm run db:seed
 * 或手动：npx tsx prisma/seed.ts
 *
 * 【种子数据说明】
 * 该脚本会创建一个测试用户，供前端登录调试。
 * 密码 "123456" 通过 bcrypt 加密后存储，开发阶段可以直接用此账号登录。
 *
 * 【Prisma 7 注意】
 * 种子脚本需要单独创建 PrismaClient 实例（不使用 src/lib/prisma.ts 中的单例），
 * 但 Prisma 7 强制要求传入 adapter，所以需要和主应用一样传入 PrismaPg 适配器。
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcrypt";

// ========== 创建适配器 ==========
// Prisma 7 必须通过 driver adapter 连接数据库
const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL || "",
});

// ========== 创建独立的 PrismaClient 实例 ==========
// 种子脚本使用独立实例，避免与主应用的单例冲突
const prisma = new PrismaClient({
  adapter,
  log: ["error", "warn"],
});

async function main() {
  console.log("\n🌱 开始执行数据库种子脚本...\n");

  // ========== 创建测试用户 ==========
  const testEmail = "admin@example.com";
  const testPassword = "123456";

  // 检查测试用户是否已存在（避免重复创建）
  const existingUser = await prisma.user.findUnique({
    where: { email: testEmail },
  });

  if (existingUser) {
    console.log(`⚠️  测试用户 ${testEmail} 已存在，跳过创建。`);
  } else {
    // 加密密码
    const hashedPassword = await bcrypt.hash(testPassword, 10);

    // 创建用户
    const user = await prisma.user.create({
      data: {
        email: testEmail,
        password: hashedPassword,
        name: "测试用户",
      },
    });

    console.log("✅ 测试用户创建成功：");
    console.log(`   ID       : ${user.id}`);
    console.log(`   邮箱     : ${user.email}`);
    console.log(`   密码     : ${testPassword}（明文，仅开发使用）`);
    console.log(`   密文     : ${hashedPassword.substring(0, 20)}...`);
    console.log(`   昵称     : ${user.name}`);
  }

  console.log("\n🎉 种子脚本执行完成！");
}

main()
  .catch((e) => {
    console.error("❌ 种子脚本执行失败：", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
