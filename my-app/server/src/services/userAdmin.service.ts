/**
 * ============================================
 * 用户管理服务（User Admin Service）
 * ============================================
 *
 * 【职责】
 * 面向「管理侧」的用户操作（区别于 user.service 的用户自助资料）：
 * - 用户列表（分页 + 关键字搜索 + 角色）；P1-8
 * - 分配角色（事务全量重写 UserRole）；
 * - 停用/启用账号（禁止操作自己）。
 *
 * 【错误约定】
 * 业务校验错误统一抛 MenuValidationError（复用 menu.service 的错误类，
 * 路由层 instanceof 识别 → 400/404）。
 */

import prisma from "../lib/prisma.js";
import { ROLE_CODES, getUserRoleCodes, isAdminRole } from "../middleware/rbac.js";
import { MenuValidationError } from "./menu.service.js";
import type { AdminUserItem, UserStatus } from "../types/index.js";

/** 合法账号状态 */
const VALID_STATUS: UserStatus[] = ["active", "disabled"];

/**
 * 用户列表（分页 + 关键字）。
 *
 * 关键字匹配 email 或 name（不区分大小写）。
 *
 * @param params - { keyword?, page?, pageSize? }
 * @returns { items, total, page, pageSize }
 */
export async function listUsers(params: {
  keyword?: string;
  page?: number;
  pageSize?: number;
}): Promise<{
  items: AdminUserItem[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 10));
  const keyword = params.keyword?.trim();

  const where = keyword
    ? {
        OR: [
          { email: { contains: keyword, mode: "insensitive" as const } },
          { name: { contains: keyword, mode: "insensitive" as const } },
        ],
      }
    : {};

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        email: true,
        name: true,
        status: true,
        createdAt: true,
        userRoles: {
          select: {
            role: { select: { id: true, code: true, name: true } },
          },
        },
      },
    }),
  ]);

  const items: AdminUserItem[] = users.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    roles: u.userRoles.map((ur) => ur.role),
    status: (u.status === "disabled" ? "disabled" : "active") as UserStatus,
    createdAt: u.createdAt.toISOString(),
  }));

  return { items, total, page, pageSize };
}

/**
 * 分配角色（全量重写该用户的角色绑定）。
 *
 * 事务内先清空原绑定再写入新绑定，保证一致性。
 *
 * 【提权防护（安全加固）】
 * 若待分配角色中包含 admin 角色，则要求「操作者本人」具备 admin 角色，
 * 否则拒绝（400）。防止被授予 `system:user:grant` 的非 admin 角色用户，
 * 通过本接口给自己或他人赋 admin 角色，形成权限提升。
 * 操作者身份由路由层从服务端会话（JWT）取得后传入，绝不信前端传参。
 *
 * @param operatorId - 操作者用户 id（来自服务端会话，路由层 requireUser 取得）
 * @param userId     - 目标用户 id
 * @param roleIds    - 角色 id 数组（全量）
 */
export async function assignRoles(
  operatorId: string,
  userId: string,
  roleIds: string[]
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new MenuValidationError("用户不存在", 404);
  }

  const unique = Array.from(new Set(roleIds));

  // 校验角色均存在（并取出角色实体，供提权判定使用）
  const targetRoles =
    unique.length > 0
      ? await prisma.role.findMany({ where: { id: { in: unique } } })
      : [];

  if (targetRoles.length !== unique.length) {
    throw new MenuValidationError("包含不存在的角色");
  }

  // ★ 提权防护：分配 admin 角色者必须是 admin（复用 rbac 单一事实源）
  const includesAdminRole = targetRoles.some((role) => role.code === ROLE_CODES.ADMIN);
  if (includesAdminRole) {
    const operatorRoleCodes = await getUserRoleCodes(operatorId);
    if (!isAdminRole(operatorRoleCodes)) {
      throw new MenuValidationError("只有管理员可以分配管理员角色");
    }
  }

  await prisma.$transaction([
    prisma.userRole.deleteMany({ where: { userId } }),
    prisma.userRole.createMany({
      data: unique.map((roleId) => ({ userId, roleId })),
      skipDuplicates: true,
    }),
  ]);
}

/**
 * 停用 / 启用用户。
 *
 * 依据 P0-10 ④：不允许停用当前登录的自己。
 *
 * @param userId     - 目标用户 id
 * @param status     - 目标状态 active | disabled
 * @param operatorId - 当前操作人 id（用于禁止操作自己）
 */
export async function setStatus(
  userId: string,
  status: UserStatus,
  operatorId: string
): Promise<void> {
  if (!VALID_STATUS.includes(status)) {
    throw new MenuValidationError("账号状态不合法，仅支持 active（启用）/ disabled（停用）");
  }

  if (userId === operatorId) {
    throw new MenuValidationError("不能停用当前登录账号");
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new MenuValidationError("用户不存在", 404);
  }

  await prisma.user.update({
    where: { id: userId },
    data: { status },
  });
}
