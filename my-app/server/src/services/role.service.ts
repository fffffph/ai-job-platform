/**
 * ============================================
 * 角色服务（Role Service）
 * ============================================
 *
 * 【职责】
 * 收敛「角色」相关的全部业务规则：
 * - 角色列表（含关联用户数、绑定菜单数，admin 的菜单数特殊处理）；
 * - 角色 CRUD（code 不可改、内置角色不可删、删除前置校验）；
 * - 角色-菜单绑定（getRoleMenuIds / setRoleMenus，admin 拒绝）。
 *
 * 【错误约定】
 * 业务校验错误统一抛 MenuValidationError（复用 menu.service 的错误类，
 * 路由层 instanceof 识别 → 400/404）。
 */

import prisma from "../lib/prisma.js";
import { ROLE_CODES } from "../middleware/rbac.js";
import { MenuValidationError } from "./menu.service.js";
import type { RoleListItem } from "../types/index.js";

/** 角色 code 命名规范：小写字母开头，仅含小写字母/数字/:/-/_ */
const ROLE_CODE_PATTERN = /^[a-z][a-z0-9:_-]*$/;

/** 角色 code 长度上限（健壮性：防止超长 code 入库） */
const MAX_ROLE_CODE_LENGTH = 64;

// ============================================================
// 查询
// ============================================================

/**
 * 角色列表（含关联用户数与绑定菜单数）。
 *
 * - admin 角色：menuCount 置 null（表示"全部权限"，前端据此显示不可编辑）；
 * - 其它角色：menuCount 为其 RoleMenu 绑定数量。
 *
 * @returns 角色列表项数组
 */
export async function listRoles(): Promise<RoleListItem[]> {
  const roles = await prisma.role.findMany({ orderBy: { createdAt: "asc" } });

  const result: RoleListItem[] = [];
  for (const role of roles) {
    const userCount = await prisma.userRole.count({ where: { roleId: role.id } });
    // admin 不写 RoleMenu，用 null 表示"全部权限"
    const menuCount =
      role.code === ROLE_CODES.ADMIN
        ? null
        : await prisma.roleMenu.count({ where: { roleId: role.id } });

    result.push({
      id: role.id,
      code: role.code,
      name: role.name,
      description: role.description,
      isSystem: role.isSystem,
      userCount,
      menuCount,
    });
  }

  return result;
}

/**
 * 查询角色已绑定的菜单 id 列表。
 *
 * @param roleId - 角色 id
 * @returns 菜单 id 数组
 */
export async function getRoleMenuIds(roleId: string): Promise<string[]> {
  const role = await prisma.role.findUnique({ where: { id: roleId } });
  if (!role) {
    throw new MenuValidationError("角色不存在", 404);
  }

  const links = await prisma.roleMenu.findMany({
    where: { roleId },
    select: { menuId: true },
  });
  return links.map((l) => l.menuId);
}

// ============================================================
// 写操作（CRUD）
// ============================================================

/**
 * 新增角色。
 *
 * 校验：code 规范 → code 全局唯一。
 *
 * @param input - { code, name, description? }
 * @returns 新建的角色记录
 */
export async function createRole(input: {
  code: string;
  name: string;
  description?: string;
}) {
  if (!input.code || !ROLE_CODE_PATTERN.test(input.code)) {
    throw new MenuValidationError(
      "角色标识码不符合规范：应以小写字母开头，仅含小写字母/数字/冒号/连字符/下划线"
    );
  }
  if (input.code.length > MAX_ROLE_CODE_LENGTH) {
    throw new MenuValidationError(
      `角色标识码长度不能超过 ${MAX_ROLE_CODE_LENGTH} 个字符`
    );
  }
  if (!input.name || !input.name.trim()) {
    throw new MenuValidationError("请填写角色名称");
  }

  const existing = await prisma.role.findUnique({ where: { code: input.code } });
  if (existing) {
    throw new MenuValidationError(`角色标识码「${input.code}」已存在，请更换`);
  }

  return prisma.role.create({
    data: {
      code: input.code,
      name: input.name.trim(),
      description: input.description ?? null,
      isSystem: false,
    },
  });
}

/**
 * 编辑角色。
 *
 * 依据决策 D1：角色 code 创建后不可修改（业务代码与权限码强依赖 code）。
 * 仅更新 name / description；若请求携带与现有值不同的 code，则拒绝。
 *
 * @param id    - 角色 id
 * @param input - { name?, description?, code? }
 * @returns 更新后的角色记录
 */
export async function updateRole(
  id: string,
  input: { name?: string; description?: string; code?: string }
) {
  const role = await prisma.role.findUnique({ where: { id } });
  if (!role) {
    throw new MenuValidationError("角色不存在", 404);
  }

  // ★ D1：拒绝 code 变更
  if (input.code !== undefined && input.code !== role.code) {
    throw new MenuValidationError("角色标识码创建后不可修改");
  }

  return prisma.role.update({
    where: { id },
    data: {
      name: input.name !== undefined ? input.name.trim() : role.name,
      description: input.description !== undefined ? input.description : role.description,
    },
  });
}

/**
 * 删除角色。
 *
 * 依据决策 D4/A3：
 * - 内置角色（admin/user，isSystem=true）不可删除；
 * - 仍有用户关联的角色不可删除（提示关联用户数）。
 *
 * @param id - 角色 id
 */
export async function deleteRole(id: string): Promise<void> {
  const role = await prisma.role.findUnique({ where: { id } });
  if (!role) {
    throw new MenuValidationError("角色不存在", 404);
  }

  if (role.isSystem || role.code === ROLE_CODES.ADMIN) {
    throw new MenuValidationError("系统内置角色不可删除");
  }

  const userCount = await prisma.userRole.count({ where: { roleId: id } });
  if (userCount > 0) {
    throw new MenuValidationError(`该角色下仍有 ${userCount} 个用户，请先调整后再删除`);
  }

  await prisma.role.delete({ where: { id } });
}

/**
 * 保存角色-菜单绑定（全量重写）。
 *
 * 依据 P0-12：admin 角色权限不可修改（短路全权，不写绑定）。
 * 事务内先清空原绑定再写入新绑定，保证一致性。
 *
 * @param roleId  - 角色 id
 * @param menuIds - 勾选的菜单 id 数组（全量）
 */
export async function setRoleMenus(roleId: string, menuIds: string[]): Promise<void> {
  const role = await prisma.role.findUnique({ where: { id: roleId } });
  if (!role) {
    throw new MenuValidationError("角色不存在", 404);
  }

  if (role.code === ROLE_CODES.ADMIN) {
    throw new MenuValidationError("管理员角色权限不可修改");
  }

  const unique = Array.from(new Set(menuIds));

  // 校验 menuIds 均存在，避免外键错误
  if (unique.length > 0) {
    const validCount = await prisma.menu.count({ where: { id: { in: unique } } });
    if (validCount !== unique.length) {
      throw new MenuValidationError("包含不存在的菜单");
    }
  }

  await prisma.$transaction([
    prisma.roleMenu.deleteMany({ where: { roleId } }),
    prisma.roleMenu.createMany({
      data: unique.map((menuId) => ({ roleId, menuId })),
      skipDuplicates: true,
    }),
  ]);
}
