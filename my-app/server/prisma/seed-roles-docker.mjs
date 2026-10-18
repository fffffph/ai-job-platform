/**
 * ============================================
 * 容器启动自动种子脚本（角色 + 菜单）
 * ============================================
 * 【为什么需要它】
 * Dockerfile 的 CMD 只跑 `prisma db push`（同步表结构），不负责灌数据。
 * 结果就是：库是空的 —— roles 表没有 user 角色、menus 表 0 条，
 * admin 角色虽然走代码短路（拥有全部权限码），但侧边栏菜单是
 * "读全量菜单表"渲染的，表空 → 看不到「系统设置」。本次故障就由此产生。
 *
 * 【为什么不用 prisma/seed-roles.ts】
 * runner 阶段只拷贝 dist/（编译产物），没有 src/ 源码，
 * seed-roles.ts 里 import "../src/middleware/rbac.js" 会直接报错。
 * 所以这里做成自包含 ESM：把权限码与菜单定义内联，只依赖
 * 容器内已 generate 好的 @prisma/client + @prisma/adapter-pg。
 *
 * 【执行时机】
 * 已写入 Dockerfile 的 CMD：
 *   prisma db push → node prisma/seed-roles-docker.mjs → npm start
 * 每次容器启动都会执行；因为全部是 upsert，重复执行无副作用（幂等），
 * 也不会覆盖后台在「菜单管理」里改过的数据顺序之外的业务数据。
 *
 * 【手动执行】
 *   docker compose exec server node prisma/seed-roles-docker.mjs
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// ---------- 创建适配器 + 客户端（Prisma 7 必须传 adapter） ----------
const adapter = new PrismaPg({
  connectionString:
    process.env.DATABASE_URL ||
    "postgresql://postgres:postgres@postgres:5432/careerai?schema=public",
});
const prisma = new PrismaClient({ adapter, log: ["error", "warn"] });

// ---------- 角色码 ----------
const ROLE_ADMIN = "admin";
const ROLE_USER = "user";

// ---------- 菜单种子定义（与 seed-roles.ts 完全对齐 + B-P1 三个用户按钮） ----------
// parentCode 在数组中先于子节点出现，保证 upsert 顺序正确
const MENU_SEEDS = [
  // 一级：5 个业务菜单（绑定 user 角色）
  { code: "dashboard", type: "menu", name: "工作台", path: "/dashboard", icon: "dashboard", sort: 10 },
  { code: "jobs", type: "menu", name: "职位发现", path: "/dashboard/jobs", icon: "project", sort: 20 },
  { code: "resume", type: "menu", name: "简历优化", path: "/dashboard/resume", icon: "file-text", sort: 30 },
  { code: "profile", type: "menu", name: "个人中心", path: "/dashboard/profile", icon: "user", sort: 40 },
  { code: "history", type: "menu", name: "决策历史", path: "/dashboard/history", icon: "history", sort: 50 },

  // 一级：系统设置目录（仅 admin，走代码短路，不写绑定）
  { code: "system", type: "catalog", name: "系统设置", path: null, icon: "setting", sort: 90 },

  // 二级：系统设置下的 4 个菜单
  { code: "system:config", type: "menu", name: "基础配置", path: "/dashboard/system/config", icon: "setting", sort: 10, parentCode: "system" },
  { code: "system:menu", type: "menu", name: "菜单管理", path: "/dashboard/system/menu", icon: "menu", sort: 20, parentCode: "system" },
  { code: "system:role", type: "menu", name: "角色管理", path: "/dashboard/system/role", icon: "team", sort: 30, parentCode: "system" },
  { code: "system:user", type: "menu", name: "用户管理", path: "/dashboard/system/user", icon: "usergroup", sort: 40, parentCode: "system" },

  // 三级：按钮级权限码
  { code: "system:config:update", type: "button", name: "保存配置", sort: 10, parentCode: "system:config" },
  { code: "system:menu:create", type: "button", name: "新增菜单", sort: 10, parentCode: "system:menu" },
  { code: "system:menu:update", type: "button", name: "编辑菜单", sort: 20, parentCode: "system:menu" },
  { code: "system:menu:delete", type: "button", name: "删除菜单", sort: 30, parentCode: "system:menu" },
  { code: "system:role:create", type: "button", name: "新增角色", sort: 10, parentCode: "system:role" },
  { code: "system:role:update", type: "button", name: "编辑角色", sort: 20, parentCode: "system:role" },
  { code: "system:role:delete", type: "button", name: "删除角色", sort: 30, parentCode: "system:role" },
  { code: "system:role:grant", type: "button", name: "分配权限", sort: 40, parentCode: "system:role" },
  { code: "system:user:create", type: "button", name: "新增用户", sort: 5, parentCode: "system:user" },
  { code: "system:user:grant", type: "button", name: "分配角色", sort: 10, parentCode: "system:user" },
  { code: "system:user:disable", type: "button", name: "停用用户", sort: 20, parentCode: "system:user" },
  // B-P1 补充的 3 个用户管理按钮
  { code: "system:user:update", type: "button", name: "编辑用户", sort: 30, parentCode: "system:user" },
  { code: "system:user:reset-password", type: "button", name: "重置密码", sort: 40, parentCode: "system:user" },
  { code: "system:user:delete", type: "button", name: "删除用户", sort: 50, parentCode: "system:user" },
];

// user 角色默认可见的 5 个业务菜单
const USER_MENU_CODES = ["dashboard", "jobs", "resume", "profile", "history"];

async function main() {
  console.log("=== 开始初始化角色与菜单（Docker 版） ===\n");

  // ---------- 1. upsert 两个系统角色 ----------
  const adminRole = await prisma.role.upsert({
    where: { code: ROLE_ADMIN },
    update: { name: "系统管理员", description: "系统管理员，拥有全部权限（不可修改/删除）", isSystem: true },
    create: { code: ROLE_ADMIN, name: "系统管理员", description: "系统管理员，拥有全部权限（不可修改/删除）", isSystem: true },
  });
  const userRole = await prisma.role.upsert({
    where: { code: ROLE_USER },
    update: { name: "普通用户", description: "默认角色，使用业务功能", isSystem: true },
    create: { code: ROLE_USER, name: "普通用户", description: "默认角色，使用业务功能", isSystem: true },
  });
  console.log(`OK 角色: ${adminRole.code} / ${userRole.code}`);

  // ---------- 2. 幂等 upsert 菜单树 ----------
  const codeToId = new Map();
  for (const seed of MENU_SEEDS) {
    const parentId = seed.parentCode ? codeToId.get(seed.parentCode) ?? null : null;
    const data = {
      type: seed.type,
      name: seed.name,
      path: seed.path ?? null,
      icon: seed.icon ?? null,
      sort: seed.sort,
      parentId,
      status: "active",
      visible: true,
    };
    const menu = await prisma.menu.upsert({
      where: { code: seed.code },
      // 【为什么 update 里不含 status / visible】
      // 这两个字段是运行时运维字段（在「菜单管理」页可改）。
      // 若每次容器启动都强制写回 active/true，
      // 管理员临时停用某个菜单的配置会在重启后被悄悄还原 —— 属于数据事故。
      // 因此只同步「代码里定义的静态属性」，保留运维侧的状态与显隐。
      update: {
        type: data.type,
        name: data.name,
        path: data.path,
        icon: data.icon,
        sort: data.sort,
        parentId: data.parentId,
      },
      create: { code: seed.code, ...data },
    });
    codeToId.set(seed.code, menu.id);
  }
  console.log(`OK 菜单: ${MENU_SEEDS.length} 条`);

  // ---------- 3. user 角色绑定 5 个业务菜单（admin 不写绑定） ----------
  let bound = 0;
  for (const code of USER_MENU_CODES) {
    const menuId = codeToId.get(code);
    if (!menuId) continue;
    await prisma.roleMenu.upsert({
      where: { roleId_menuId: { roleId: userRole.id, menuId } },
      update: {},
      create: { roleId: userRole.id, menuId },
    });
    bound += 1;
  }
  console.log(`OK user 角色绑定 ${bound} 个业务菜单`);

  // ---------- 4. 兜底：给没有任何角色的活跃用户补绑 user 角色 ----------
  // （你的 admin 账号已有 admin 角色会自动跳过，不受影响）
  const users = await prisma.user.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, email: true, userRoles: { select: { roleId: true } } },
  });
  for (const u of users) {
    if (u.userRoles.length === 0) {
      await prisma.userRole.create({ data: { userId: u.id, roleId: userRole.id } });
      console.log(`OK 已为无角色用户补绑 user 角色: ${u.email || u.name || u.id}`);
    }
  }

  // ---------- 5. 校验 ----------
  const menuTotal = await prisma.menu.count();
  const rmTotal = await prisma.roleMenu.count();
  const adminUserRoles = users.find((u) => u.userRoles.some((r) => r.roleId === adminRole.id))
    ? "admin 账号已绑定 admin 角色（全权短路）"
    : "注意：未发现绑定 admin 角色的用户！";
  console.log(`\n=== 校验: menus=${menuTotal}, role_menus=${rmTotal} ===`);
  console.log(`=== ${adminUserRoles} ===`);
  console.log("=== 完成 ===");
}

main()
  .catch((e) => {
    console.error("FAIL:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
