/**
 * ============================================
 * RBAC 权限中间件（Role-Based Access Control）
 * ============================================
 *
 * 【职责】
 * 在 JWT 认证（authMiddleware）之后，做「角色级」与「权限码级」的权限校验。
 * authMiddleware 负责"验票"（确认你是谁），本模块负责"授权"（确认你能不能做）。
 *
 * 【设计说明】
 * - 角色用「代码 code」判断（admin / user），不用中文名，避免业务逻辑与展示文案耦合。
 * - 权限从「角色」下沉到「权限码」：菜单/按钮节点的 code 即权限码，
 *   通过 RoleMenu（角色-菜单绑定）授权；本模块提供 requirePermission(...codes)。
 * - admin 短路：只要用户角色含 admin，则鉴权直接放行、取菜单/权限直接返全量，
 *   全程不查 RoleMenu（唯一判断入口 isAdminRole，被三处复用）。
 * - 鉴权实时读库（不缓存用户权限），保证后端权限变更即时生效。
 *
 * 【使用方式】
 * import { requireRole, requirePermission } from "../middleware/rbac.js";
 * router.put("/config", authMiddleware, requirePermission(PERMISSION_CODES.CONFIG_UPDATE), handler);
 *
 * 【错误码约定】
 * - 401 UNAUTHORIZED : 未登录（理论上 authMiddleware 已拦截，这里兜底）
 * - 403 FORBIDDEN    : 已登录但权限不满足，无权限执行此操作
 */

import type { Request, Response, NextFunction } from "express";
import prisma from "../lib/prisma.js";
import { requireUser } from "./auth.js";
import type { MenuTreeNode } from "../types/index.js";

/**
 * 系统预置角色代码常量
 *
 * 集中定义，业务代码一律引用这里，避免魔法字符串散落各处。
 */
export const ROLE_CODES = {
  /** 管理员：拥有全部权限（鉴权短路）、角色不可删除 */
  ADMIN: "admin",
  /** 普通用户：默认角色，使用业务功能 */
  USER: "user",
} as const;

/**
 * 权限码常量（单一事实源 · 后端）
 *
 * 与前端 `my-app/lib/permissions.ts` 的 PERMISSIONS 值必须一致。
 * 业务代码禁止硬编码权限码字符串，一律引用本常量；新增权限码时两处同步更新。
 */
export const PERMISSION_CODES = {
  /** 系统设置目录 */
  SYSTEM: "system",
  /** 基础配置菜单 */
  SYSTEM_CONFIG: "system:config",
  /** 菜单管理菜单 */
  SYSTEM_MENU: "system:menu",
  /** 角色管理菜单 */
  SYSTEM_ROLE: "system:role",
  /** 用户管理菜单 */
  SYSTEM_USER: "system:user",
  /** 保存/恢复配置（按钮） */
  CONFIG_UPDATE: "system:config:update",
  /** 新增菜单（按钮） */
  MENU_CREATE: "system:menu:create",
  /** 编辑菜单（按钮） */
  MENU_UPDATE: "system:menu:update",
  /** 删除菜单（按钮） */
  MENU_DELETE: "system:menu:delete",
  /** 新增角色（按钮） */
  ROLE_CREATE: "system:role:create",
  /** 编辑角色（按钮） */
  ROLE_UPDATE: "system:role:update",
  /** 删除角色（按钮） */
  ROLE_DELETE: "system:role:delete",
  /** 分配权限（按钮） */
  ROLE_GRANT: "system:role:grant",
  /** 分配角色（按钮） */
  USER_GRANT: "system:user:grant",
  /** 停用用户（按钮） */
  USER_DISABLE: "system:user:disable",
} as const;

/**
 * 菜单节点类型常量
 */
export const MENU_TYPES = {
  /** 目录：可展开的父级，无路由 */
  CATALOG: "catalog",
  /** 菜单：带路由的具体页面 */
  MENU: "menu",
  /** 按钮：按钮级权限码，不展示在侧边栏 */
  BUTTON: "button",
} as const;

/** 侧边栏可取用的节点类型（catalog + menu，剔除 button） */
const SIDEBAR_TYPES = [MENU_TYPES.CATALOG, MENU_TYPES.MENU];

/**
 * 查询指定用户的角色代码列表
 *
 * 通过 user_roles 关联表 join 出角色 code。
 * 一个用户可绑多个角色，返回全部 code 供 any-match 判断。
 *
 * @param userId - 用户 ID（来自 JWT Token 的 sub 字段）
 * @returns 角色代码数组，如 ["admin"] 或 ["user"]
 */
export async function getUserRoleCodes(userId: string): Promise<string[]> {
  // join 查询 user_roles，同时取出 role.code
  const rows = await prisma.userRole.findMany({
    where: { userId },
    select: {
      role: { select: { code: true } },
    },
  });

  return rows.map((row) => row.role.code);
}

/**
 * 判断角色集合是否包含管理员。
 *
 * 【唯一入口】admin 全权短路逻辑的唯一判断点，被 requirePermission、
 * getUserPermissions、getUserMenuTree 三处复用，保证规则一致。
 *
 * @param roleCodes - 用户角色代码数组
 * @returns 是否管理员
 */
export function isAdminRole(roleCodes: string[]): boolean {
  return roleCodes.includes(ROLE_CODES.ADMIN);
}

/**
 * 查询用户被授权的「全部权限码」。
 *
 * 权限码来源为菜单树所有节点（catalog/menu/button）的 code：
 * - admin 短路：返回全量启用节点的 code（不查 RoleMenu）；
 * - 普通用户：join RoleMenu，返回其角色绑定的节点 code（去重）。
 *
 * 【为什么包含目录/菜单级 code？】
 * requirePermission 既用于按钮级（system:role:grant），也用于菜单级
 * （system:menu / system:role / system:user 等页面访问）。因此权限集合需
 * 涵盖所有节点 code，而非仅 button，才能对页面级接口正确鉴权。
 *
 * @param userId    - 用户 ID
 * @param roleCodes - 可选的已查角色数组（避免重复查库）
 * @returns 权限码数组（去重）
 */
export async function getUserPermissions(
  userId: string,
  roleCodes?: string[]
): Promise<string[]> {
  const codes = roleCodes ?? (await getUserRoleCodes(userId));

  // admin 短路：直接返回全量启用节点 code，不查 RoleMenu
  if (isAdminRole(codes)) {
    const all = await prisma.menu.findMany({
      where: { status: "active" },
      select: { code: true },
    });
    return all.map((m) => m.code);
  }

  // 普通用户：join 角色绑定的菜单，取其 code
  const links = await prisma.roleMenu.findMany({
    where: {
      role: { code: { in: codes } },
      menu: { status: "active" },
    },
    select: { menu: { select: { code: true } } },
  });

  return Array.from(new Set(links.map((l) => l.menu.code)));
}

/** buildMenuTree 的输入行结构（Prisma Menu 的结构子集） */
export interface MenuTreeRow {
  id: string;
  parentId: string | null;
  code: string;
  name: string;
  path: string | null;
  icon: string | null;
  sort: number;
  /** 是否显示在侧边栏（构建侧边栏树时用于过滤，buildMenuTree 本身不使用） */
  visible: boolean;
}

/**
 * 平铺菜单数组 → 嵌套菜单树（按 sort 升序）。
 *
 * - 依据 parentId 组装父子关系；
 * - 若某节点的 parentId 不在集合内（如非 admin 只授权了子节点），
 *   则将其视为根节点，保证不漏展示；
 * - 空 children 数组会被裁掉，前端据此判断是否为叶子。
 *
 * @param menus - 平铺菜单行数组
 * @returns 嵌套的 MenuTreeNode 数组
 */
export function buildMenuTree(menus: MenuTreeRow[]): MenuTreeNode[] {
  const nodes = new Map<string, MenuTreeNode>();
  for (const m of menus) {
    nodes.set(m.id, {
      id: m.id,
      code: m.code,
      name: m.name,
      path: m.path,
      icon: m.icon,
      sort: m.sort,
    });
  }

  const roots: MenuTreeNode[] = [];
  for (const m of menus) {
    const node = nodes.get(m.id)!;
    // 有有效父级 → 挂到父节点 children 下；否则作为根节点
    if (m.parentId && nodes.has(m.parentId)) {
      const parent = nodes.get(m.parentId)!;
      (parent.children ??= []).push(node);
    } else {
      roots.push(node);
    }
  }

  // 递归按 sort 升序排序，并裁掉空 children
  const normalize = (arr: MenuTreeNode[]): void => {
    arr.sort((a, b) => a.sort - b.sort);
    for (const n of arr) {
      if (n.children && n.children.length > 0) {
        normalize(n.children);
      } else {
        delete n.children;
      }
    }
  };
  normalize(roots);

  return roots;
}

/**
 * 查询当前用户的「侧边栏菜单树」（catalog + menu 两级，剔除 button）。
 *
 * - admin 短路：返回全量可见菜单树（不查 RoleMenu）；
 * - 普通用户：返回其角色绑定的菜单（catalog + menu）构成的树；
 * - 过滤 status === "disabled" 与 visible === false（侧边栏语义）。
 *
 * @param userId    - 用户 ID
 * @param roleCodes - 可选的已查角色数组（避免重复查库）
 * @returns 嵌套菜单树
 */
export async function getUserMenuTree(
  userId: string,
  roleCodes?: string[]
): Promise<MenuTreeNode[]> {
  const codes = roleCodes ?? (await getUserRoleCodes(userId));

  let rows: MenuTreeRow[];
  if (isAdminRole(codes)) {
    // admin：全量 catalog + menu
    rows = await prisma.menu.findMany({
      where: { type: { in: SIDEBAR_TYPES }, status: "active" },
      select: {
        id: true,
        parentId: true,
        code: true,
        name: true,
        path: true,
        icon: true,
        sort: true,
        visible: true,
      },
    });
  } else {
    const links = await prisma.roleMenu.findMany({
      where: {
        role: { code: { in: codes } },
        menu: { type: { in: SIDEBAR_TYPES }, status: "active" },
      },
      select: {
        menu: {
          select: {
            id: true,
            parentId: true,
            code: true,
            name: true,
            path: true,
            icon: true,
            sort: true,
            visible: true,
          },
        },
      },
    });
    rows = links.map((l) => l.menu);
  }

  // 过滤不在侧边栏展示的节点，再构建树
  const visibleRows = rows.filter((r) => r.visible);
  return buildMenuTree(visibleRows);
}

/**
 * 角色校验中间件工厂
 *
 * 用法：requireRole("admin") 或 requireRole("admin", "super_admin")
 * 只要用户具备其中任意一个角色即放行。
 * （保留此中间件以兼容旧调用，新代码优先用 requirePermission。）
 *
 * @param codes - 允许通过的角色代码（可变参数）
 * @returns Express 中间件函数
 */
export function requireRole(...codes: string[]) {
  // 返回真正的中间件函数（闭包捕获 codes）
  return async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      // 兜底：理论上 authMiddleware 已拦截未登录请求，这里防御性校验。
      // requireUser 内部即为「取 ID + 未登录写 401」，全项目统一一份实现。
      const userId = requireUser(req, res);
      if (!userId) return;

      // 查询用户实际角色
      const roles = await getUserRoleCodes(userId);

      // any-match：具备任一允许角色即通过
      const allowed = roles.some((role) => codes.includes(role));

      if (!allowed) {
        res.status(403).json({
          success: false,
          message: "无权限执行此操作",
          code: "FORBIDDEN",
        });
        return;
      }

      // 校验通过，放行到路由处理器
      next();
    } catch (error) {
      // 数据库查询异常等，交给全局错误处理器
      next(error);
    }
  };
}

/**
 * 权限码校验中间件工厂
 *
 * 用法：requirePermission("system:role:grant") 或 requirePermission("a", "b")
 * 语义为「拥有任一 code 即放行」；用户为 admin 时短路放行（不查 RoleMenu）。
 * 校验实时读库，保证后端鉴权即时生效。
 *
 * @param codes - 允许通过的权限码（可变参数）
 * @returns Express 中间件函数
 */
export function requirePermission(...codes: string[]) {
  return async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      // 兜底：未登录直接 401（authMiddleware 已拦，这里防御性校验）
      const userId = requireUser(req, res);
      if (!userId) return;

      const roles = await getUserRoleCodes(userId);

      // ★ admin 短路：具备 admin 角色直接放行，不查 RoleMenu
      if (isAdminRole(roles)) {
        next();
        return;
      }

      const permissions = await getUserPermissions(userId, roles);
      const allowed = permissions.some((p) => codes.includes(p));

      if (!allowed) {
        res.status(403).json({
          success: false,
          message: "无权限执行此操作",
          code: "FORBIDDEN",
        });
        return;
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}
