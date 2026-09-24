/**
 * ============================================
 * 角色种子脚本（RBAC 角色地基）
 * ============================================
 *
 * 【职责】
 * 幂等地初始化系统角色，并把首个管理员绑定到 admin 角色。
 * 可重复执行，不会产生重复数据。
 *
 * 【为什么独立于 seed.ts？】
 * seed.ts 负责创建测试用户（含密码哈希等敏感数据）。
 * 角色与权限是独立的系统数据，单独成脚本便于：
 * 1. 不影响已有用户数据，随时可重跑
 * 2. 后期「角色管理」功能上线后，此脚本可作为初始化基线
 *
 * 【执行方式】
 * npm run db:seed:roles
 * 或：npx tsx prisma/seed-roles.ts
 *
 * 【幂等性说明】
 * - 角色用 upsert（按 code 唯一键），重复执行不报错
 * - 用户绑定用「先查再建」，已绑定则跳过
 * - admin@example.com 不存在时仅告警，不创建（密码哈希无法在此安全生成）
 */

// 必须最先 import，确保 .env 加载先于 prisma 客户端（读取 DATABASE_URL）
import "dotenv/config";
import prisma from "../src/lib/prisma.js";
import { ROLE_CODES } from "../src/middleware/rbac.js";

/**
 * 首个管理员邮箱
 *
 * 该用户由 seed.ts 创建（若尚未创建，本脚本会告警提示先跑 seed）。
 */
const FIRST_ADMIN_EMAIL = "admin@example.com";

/**
 * 角色种子执行入口
 */
async function main(): Promise<void> {
  console.log("=== 开始初始化系统角色 ===\n");

  // ---------- 步骤 1：upsert 两个基础角色 ----------
  // 按 code 唯一键 upsert，重复执行不报错
  const adminRole = await prisma.role.upsert({
    where: { code: ROLE_CODES.ADMIN },
    update: { name: "管理员", description: "系统管理员，可增删改查系统配置" },
    create: { code: ROLE_CODES.ADMIN, name: "管理员", description: "系统管理员，可增删改查系统配置" },
  });

  const userRole = await prisma.role.upsert({
    where: { code: ROLE_CODES.USER },
    update: { name: "普通用户", description: "默认角色，使用业务功能" },
    create: { code: ROLE_CODES.USER, name: "普通用户", description: "默认角色，使用业务功能" },
  });

  console.log(`✓ 角色已就绪：${adminRole.code}（${adminRole.name}）、${userRole.code}（${userRole.name}）\n`);

  // ---------- 步骤 2：绑定首个管理员 ----------
  const adminUser = await prisma.user.findUnique({
    where: { email: FIRST_ADMIN_EMAIL },
    select: { id: true, email: true },
  });

  if (!adminUser) {
    console.warn(
      `⚠ 未找到用户 ${FIRST_ADMIN_EMAIL}，跳过管理员绑定。\n` +
      `  请先执行 npm run db:seed 创建测试用户，再重跑本脚本。`
    );
    return;
  }

  // 检查是否已绑定 admin 角色，避免重复创建
  const existing = await prisma.userRole.findUnique({
    where: {
      userId_roleId: {
        userId: adminUser.id,
        roleId: adminRole.id,
      },
    },
  });

  if (existing) {
    console.log(`✓ ${adminUser.email} 已是管理员（跳过绑定）`);
  } else {
    await prisma.userRole.create({
      data: { userId: adminUser.id, roleId: adminRole.id },
    });
    console.log(`✓ 已绑定：${adminUser.email} → admin（管理员）`);
  }

  // ---------- 步骤 3：校验结果 ----------
  const { getUserRoleCodes } = await import("../src/middleware/rbac.js");
  const roles = await getUserRoleCodes(adminUser.id);
  console.log(`\n=== 校验：${adminUser.email} 当前角色 = [${roles.join(", ")}] ===`);
  console.log("\n=== 角色初始化完成 ===");
}

// 执行入口 + 错误兜底 + 断开连接
main()
  .catch((error) => {
    console.error("❌ 角色种子执行失败:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
