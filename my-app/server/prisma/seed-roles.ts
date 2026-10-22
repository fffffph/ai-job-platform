/**
 * ============================================
 * 角色 + 菜单种子脚本（RBAC 权限体系）
 * ============================================
 *
 * 【职责】
 * 幂等地初始化系统基线数据：
 * 1. 两个基础角色（admin/user，均置 isSystem=true）；
 * 2. 菜单树（21 条：5 业务菜单 + 1 目录 + 4 二级菜单 + 11 按钮权限码）；
 * 3. 角色-菜单绑定：user 角色绑定 5 个业务菜单；admin 不写绑定（走代码短路）；
 * 4. 把首个管理员绑定到 admin 角色。
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
 * - 角色/菜单均用 upsert（按各自唯一键 code），重复执行不报错、不重复
 * - user 角色绑定用 upsert（按复合主键），已绑定则跳过
 * - admin@example.com 不存在时仅告警，不创建（密码哈希无法在此安全生成）
 */

// 必须最先 import，确保 .env 加载先于 prisma 客户端（读取 DATABASE_URL）
import "dotenv/config";
import prisma from "../src/lib/prisma.js";
import {
  ROLE_CODES,
  PERMISSION_CODES,
  MENU_TYPES,
} from "../src/middleware/rbac.js";

/**
 * 首个管理员邮箱
 *
 * 该用户由 seed.ts 创建（若尚未创建，本脚本会告警提示先跑 seed）。
 */
const FIRST_ADMIN_EMAIL = "admin@example.com";

/**
 * 菜单种子定义。
 *
 * 数组顺序保证「父节点先于子节点」——父级 code 会先被 upsert，
 * 后续子节点即可通过 codeToId 映射拿到 parentId。
 */
interface MenuSeed {
  /** 权限码 / 唯一标识 */
  code: string;
  /** 节点类型 */
  type: string;
  /** 名称 */
  name: string;
  /** 路由（button 为空） */
  path?: string | null;
  /** 图标名（button 为空） */
  icon?: string | null;
  /** 排序 */
  sort: number;
  /** 父级 code（顶级不填） */
  parentCode?: string;
}

/**
 * 基线菜单清单（对齐 PRD §3.4 / 架构 §4.5）。
 */
const MENU_SEEDS: MenuSeed[] = [
  // ---------- 一级：5 个业务菜单（绑定 user 角色） ----------
  { code: "dashboard", type: MENU_TYPES.MENU, name: "工作台", path: "/dashboard", icon: "dashboard", sort: 10 },
  { code: "jobs", type: MENU_TYPES.MENU, name: "职位发现", path: "/dashboard/jobs", icon: "project", sort: 20 },
  { code: "resume", type: MENU_TYPES.MENU, name: "简历优化", path: "/dashboard/resume", icon: "file-text", sort: 30 },
  { code: "profile", type: MENU_TYPES.MENU, name: "个人中心", path: "/dashboard/profile", icon: "user", sort: 40 },
  { code: "history", type: MENU_TYPES.MENU, name: "决策历史", path: "/dashboard/history", icon: "history", sort: 50 },

  // ---------- 一级：系统设置目录（仅 admin，不写绑定） ----------
  { code: PERMISSION_CODES.SYSTEM, type: MENU_TYPES.CATALOG, name: "系统设置", path: null, icon: "setting", sort: 90 },

  // ---------- 二级：系统设置下的 4 个菜单 ----------
  {
    code: PERMISSION_CODES.SYSTEM_CONFIG,
    type: MENU_TYPES.MENU,
    name: "基础配置",
    path: "/dashboard/system/config",
    icon: "setting",
    sort: 10,
    parentCode: PERMISSION_CODES.SYSTEM,
  },
  {
    code: PERMISSION_CODES.SYSTEM_MENU,
    type: MENU_TYPES.MENU,
    name: "菜单管理",
    path: "/dashboard/system/menu",
    icon: "menu",
    sort: 20,
    parentCode: PERMISSION_CODES.SYSTEM,
  },
  {
    code: PERMISSION_CODES.SYSTEM_ROLE,
    type: MENU_TYPES.MENU,
    name: "角色管理",
    path: "/dashboard/system/role",
    icon: "team",
    sort: 30,
    parentCode: PERMISSION_CODES.SYSTEM,
  },
  {
    code: PERMISSION_CODES.SYSTEM_USER,
    type: MENU_TYPES.MENU,
    name: "用户管理",
    path: "/dashboard/system/user",
    icon: "usergroup",
    sort: 40,
    parentCode: PERMISSION_CODES.SYSTEM,
  },

  // ---------- 三级：按钮级权限码 ----------
  { code: PERMISSION_CODES.CONFIG_UPDATE, type: MENU_TYPES.BUTTON, name: "保存配置", sort: 10, parentCode: PERMISSION_CODES.SYSTEM_CONFIG },
  { code: PERMISSION_CODES.MENU_CREATE, type: MENU_TYPES.BUTTON, name: "新增菜单", sort: 10, parentCode: PERMISSION_CODES.SYSTEM_MENU },
  { code: PERMISSION_CODES.MENU_UPDATE, type: MENU_TYPES.BUTTON, name: "编辑菜单", sort: 20, parentCode: PERMISSION_CODES.SYSTEM_MENU },
  { code: PERMISSION_CODES.MENU_DELETE, type: MENU_TYPES.BUTTON, name: "删除菜单", sort: 30, parentCode: PERMISSION_CODES.SYSTEM_MENU },
  { code: PERMISSION_CODES.ROLE_CREATE, type: MENU_TYPES.BUTTON, name: "新增角色", sort: 10, parentCode: PERMISSION_CODES.SYSTEM_ROLE },
  { code: PERMISSION_CODES.ROLE_UPDATE, type: MENU_TYPES.BUTTON, name: "编辑角色", sort: 20, parentCode: PERMISSION_CODES.SYSTEM_ROLE },
  { code: PERMISSION_CODES.ROLE_DELETE, type: MENU_TYPES.BUTTON, name: "删除角色", sort: 30, parentCode: PERMISSION_CODES.SYSTEM_ROLE },
  { code: PERMISSION_CODES.ROLE_GRANT, type: MENU_TYPES.BUTTON, name: "分配权限", sort: 40, parentCode: PERMISSION_CODES.SYSTEM_ROLE },
  { code: PERMISSION_CODES.USER_CREATE, type: MENU_TYPES.BUTTON, name: "新增用户", sort: 5, parentCode: PERMISSION_CODES.SYSTEM_USER },
  { code: PERMISSION_CODES.USER_GRANT, type: MENU_TYPES.BUTTON, name: "分配角色", sort: 10, parentCode: PERMISSION_CODES.SYSTEM_USER },
  { code: PERMISSION_CODES.USER_DISABLE, type: MENU_TYPES.BUTTON, name: "停用用户", sort: 20, parentCode: PERMISSION_CODES.SYSTEM_USER },
];

/** user 角色默认可见的 5 个业务菜单 code */
const USER_MENU_CODES = ["dashboard", "jobs", "resume", "profile", "history"];

/**
 * 角色种子执行入口
 */
async function main(): Promise<void> {
  console.log("=== 开始初始化系统角色与菜单 ===\n");

  // ---------- 步骤 1：upsert 两个基础角色（均置 isSystem=true） ----------
  // 按 code 唯一键 upsert，重复执行不报错
  const adminRole = await prisma.role.upsert({
    where: { code: ROLE_CODES.ADMIN },
    update: { name: "管理员", description: "系统管理员，拥有全部权限（不可修改/删除）", isSystem: true },
    create: { code: ROLE_CODES.ADMIN, name: "管理员", description: "系统管理员，拥有全部权限（不可修改/删除）", isSystem: true },
  });

  const userRole = await prisma.role.upsert({
    where: { code: ROLE_CODES.USER },
    update: { name: "普通用户", description: "默认角色，使用业务功能", isSystem: true },
    create: { code: ROLE_CODES.USER, name: "普通用户", description: "默认角色，使用业务功能", isSystem: true },
  });

  console.log(`✓ 角色已就绪：${adminRole.code}（${adminRole.name}）、${userRole.code}（${userRole.name}）\n`);

  // ---------- 步骤 2：幂等 upsert 菜单树 ----------
  // code → id 映射，供下级节点解析 parentId
  const codeToId = new Map<string, string>();

  for (const seed of MENU_SEEDS) {
    // 解析父级 id（父节点必须先于子节点被处理，MENU_SEEDS 已保证顺序）
    const parentId = seed.parentCode ? codeToId.get(seed.parentCode) ?? null : null;

    const data = {
      type: seed.type,
      name: seed.name,
      path: seed.path ?? null,
      icon: seed.icon ?? null,
      sort: seed.sort,
      parentId,
      // 菜单默认 active + visible；button 的 visible 无意义但保持默认 true 不影响渲染（侧边栏剔除 button）
      status: "active",
      visible: true,
    };

    const menu = await prisma.menu.upsert({
      where: { code: seed.code },
      update: data,
      create: { code: seed.code, ...data },
    });

    codeToId.set(seed.code, menu.id);
  }

  console.log(`✓ 菜单已就绪：共 ${MENU_SEEDS.length} 条（业务菜单 5 + 目录 1 + 二级菜单 4 + 按钮 11）\n`);

  // ---------- 步骤 3：绑定 user 角色 → 5 个业务菜单 ----------
  // admin 不写任何 RoleMenu 绑定（鉴权/取菜单时按角色名短路返回全量）
  let boundCount = 0;
  for (const code of USER_MENU_CODES) {
    const menuId = codeToId.get(code);
    if (!menuId) continue;
    await prisma.roleMenu.upsert({
      where: { roleId_menuId: { roleId: userRole.id, menuId } },
      update: {},
      create: { roleId: userRole.id, menuId },
    });
    boundCount += 1;
  }

  console.log(`✓ user 角色已绑定 ${boundCount} 个业务菜单（admin 角色不写绑定，走全权短路）\n`);

  // ---------- 步骤 4：绑定首个管理员 ----------
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

  // ---------- 步骤 5：校验结果 ----------
  const { getUserRoleCodes } = await import("../src/middleware/rbac.js");
  const roles = await getUserRoleCodes(adminUser.id);
  const menuTotal = await prisma.menu.count();
  const roleMenuTotal = await prisma.roleMenu.count();
  console.log(`\n=== 校验：${adminUser.email} 当前角色 = [${roles.join(", ")}] ===`);
  console.log(`=== 校验：menus=${menuTotal} 条，role_menus=${roleMenuTotal} 条 ===`);
  console.log("\n=== 角色与菜单初始化完成 ===");
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
