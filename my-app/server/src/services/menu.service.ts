/**
 * ============================================
 * 菜单服务（Menu Service）
 * ============================================
 *
 * 【职责】
 * 收敛「菜单树」相关的全部业务规则：
 * - 按用户取菜单（getMyMenus，admin 短路返回全量）；
 * - 全量菜单（管理页用，平铺数组）；
 * - 菜单 CRUD（唯一性校验、命名规范校验、删除前置校验、code 不可改）；
 * - 权限码命名规范校验（validatePermissionCode）。
 *
 * 【错误约定】
 * 业务校验错误统一抛 MenuValidationError（路由层 instanceof 识别 → 400；
 * 资源不存在时 status=404）。与现有 ConfigValidationError 同构。
 *
 * 【为什么 validatePermissionCode / MenuValidationError 放这里？】
 * 菜单是权限码的载体，命名规范属于菜单领域规则；role.service 也复用
 * MenuValidationError 表达业务校验错误，保证三处服务错误处理一致。
 */

import prisma from "../lib/prisma.js";
import {
  buildMenuTree,
  getUserMenuTree,
  getUserPermissions,
  MENU_TYPES,
} from "../middleware/rbac.js";
import type {
  MenuTreeNode,
  CreateMenuInput,
  UpdateMenuInput,
} from "../types/index.js";

// ============================================================
// 业务校验错误
// ============================================================

/**
 * 菜单（及角色/用户管理）业务校验错误。
 *
 * 用于「唯一性冲突、命名不规范、前置条件不满足、资源不存在」等场景。
 * 路由层通过 instanceof 识别后返回对应 HTTP 状态码（默认 400）。
 */
export class MenuValidationError extends Error {
  /** 建议的 HTTP 状态码（默认 400；资源不存在时传 404） */
  public readonly status: number;

  constructor(message: string, status: number = 400) {
    super(message);
    this.name = "MenuValidationError";
    this.status = status;
  }
}

/** 权限码命名规范正则：小写字母开头，仅含小写字母/数字/:/-/_ */
const PERMISSION_CODE_PATTERN = /^[a-z][a-z0-9:_-]*$/;

/** 权限码长度上限（健壮性：防止超长 code 入库） */
const MAX_PERMISSION_CODE_LENGTH = 64;

/** 合法的菜单类型集合 */
const VALID_MENU_TYPES: string[] = [
  MENU_TYPES.CATALOG,
  MENU_TYPES.MENU,
  MENU_TYPES.BUTTON,
];

// ============================================================
// 校验 / 工具
// ============================================================

/**
 * 校验权限码是否符合命名规范。
 *
 * 规则：^[a-z][a-z0-9:_-]*$，即小写字母开头、仅含小写字母/数字/:/-/_，
 * 且长度不超过 64 个字符。
 *
 * @param code - 待校验的权限码
 * @throws MenuValidationError 不符合规范或超长时抛出（400）
 */
export function validatePermissionCode(code: string): void {
  if (!code || typeof code !== "string" || !PERMISSION_CODE_PATTERN.test(code)) {
    throw new MenuValidationError(
      "权限码不符合规范：应以小写字母开头，仅含小写字母/数字/冒号/连字符/下划线，如 system:role:grant"
    );
  }
  if (code.length > MAX_PERMISSION_CODE_LENGTH) {
    throw new MenuValidationError(
      `权限码长度不能超过 ${MAX_PERMISSION_CODE_LENGTH} 个字符`
    );
  }
}

/**
 * 校验菜单类型合法性。
 *
 * @param type - 待校验类型
 * @throws MenuValidationError 非法类型时抛出（400）
 */
function validateMenuType(type: string): void {
  if (!VALID_MENU_TYPES.includes(type)) {
    throw new MenuValidationError("菜单类型不合法，仅支持 catalog（目录）/ menu（菜单）/ button（按钮）");
  }
}

/**
 * 平铺菜单数组 → 嵌套菜单树（对外暴露，供路由或其它服务复用）。
 *
 * 内部委托给 rbac.ts 的 buildMenuTree，保持树构建逻辑单一来源。
 */
export const buildTree = buildMenuTree;

// ============================================================
// 查询
// ============================================================

/**
 * 按用户获取「侧边栏菜单树 + 全部权限码」。
 *
 * - admin 短路：返回全量菜单树与全量权限码（不查 RoleMenu）；
 * - 普通用户：返回其角色授权的菜单树与权限码。
 *
 * @param userId    - 用户 ID
 * @param roleCodes - 已查出的用户角色代码数组（由路由层传入，避免重复查库）
 * @returns { menus, permissions }
 */
export async function getMyMenus(
  userId: string,
  roleCodes: string[]
): Promise<{ menus: MenuTreeNode[]; permissions: string[] }> {
  const [menus, permissions] = await Promise.all([
    getUserMenuTree(userId, roleCodes),
    getUserPermissions(userId, roleCodes),
  ]);
  return { menus, permissions };
}

/**
 * 获取全量菜单（平铺数组，含 button 与停用项），供「菜单管理」页使用。
 *
 * 返回平铺数组 + parentId，前端自行组装成 Antd Table 的 treeData
 * （依据主理人拍板 A1）。
 *
 * @returns 平铺菜单数组（按 sort 升序）
 */
export async function getFullTree() {
  return prisma.menu.findMany({
    orderBy: [{ sort: "asc" }],
  });
}

// ============================================================
// 写操作（CRUD）
// ============================================================

/**
 * 新增菜单。
 *
 * 校验：类型合法 → 权限码规范 → 权限码全局唯一 → 父级存在 → menu 类型必填 path。
 *
 * @param input - 新增入参
 * @returns 新建的菜单记录
 */
export async function createMenu(input: CreateMenuInput) {
  validateMenuType(input.type);
  validatePermissionCode(input.code);

  // 权限码全局唯一
  const existing = await prisma.menu.findUnique({ where: { code: input.code } });
  if (existing) {
    throw new MenuValidationError(`权限码「${input.code}」已存在，请更换`);
  }

  // 父级存在性校验
  if (input.parentId) {
    const parent = await prisma.menu.findUnique({ where: { id: input.parentId } });
    if (!parent) {
      throw new MenuValidationError("父级菜单不存在", 404);
    }
  }

  // menu 类型必须有路由；button 忽略路由/图标/显示
  if (input.type === MENU_TYPES.MENU && !input.path) {
    throw new MenuValidationError("菜单类型必须填写路由路径");
  }

  const isButton = input.type === MENU_TYPES.BUTTON;

  return prisma.menu.create({
    data: {
      parentId: input.parentId ?? null,
      type: input.type,
      code: input.code,
      name: input.name,
      path: isButton ? null : input.path ?? null,
      component: input.component ?? null,
      icon: isButton ? null : input.icon ?? null,
      sort: input.sort ?? 0,
      visible: isButton ? true : input.visible ?? true,
      status: input.status ?? "active",
    },
  });
}

/**
 * 编辑菜单。
 *
 * 依据主理人拍板 A2：菜单 code 创建后不可修改（与角色 code 一致），
 * 避免管理员改坏被代码引用的权限码导致鉴权失效。
 * 其余字段（名称/父级/路由/图标/排序/显示/状态）可改。
 *
 * @param id    - 菜单 id
 * @param input - 编辑入参
 * @returns 更新后的菜单记录
 */
export async function updateMenu(id: string, input: UpdateMenuInput) {
  const menu = await prisma.menu.findUnique({ where: { id } });
  if (!menu) {
    throw new MenuValidationError("菜单不存在", 404);
  }

  // ★ A2：拒绝 code 变更（若前端回传了相同 code 则忽略，不视为修改）
  if (input.code !== undefined && input.code !== menu.code) {
    throw new MenuValidationError("权限码创建后不可修改");
  }

  // 类型变更（若传）需合法
  const nextType = input.type ?? menu.type;
  validateMenuType(nextType);

  // 父级变更校验：不能选自己；父级需存在；且父级不能是自己的子孙（防环）
  if (input.parentId !== undefined && input.parentId !== null) {
    if (input.parentId === id) {
      throw new MenuValidationError("父级菜单不能是自己");
    }
    const parent = await prisma.menu.findUnique({ where: { id: input.parentId } });
    if (!parent) {
      throw new MenuValidationError("父级菜单不存在", 404);
    }
    // 向上回溯父级链，若遇到自己说明形成了环
    let cursor: string | null = parent.parentId;
    while (cursor) {
      if (cursor === id) {
        throw new MenuValidationError("父级菜单不能是自己的子孙节点");
      }
      const p: { parentId: string | null } | null = await prisma.menu.findUnique({
        where: { id: cursor },
        select: { parentId: true },
      });
      cursor = p?.parentId ?? null;
    }
  }

  const isButton = nextType === MENU_TYPES.BUTTON;
  const nextPath = input.path !== undefined ? input.path : menu.path;

  if (nextType === MENU_TYPES.MENU && !nextPath) {
    throw new MenuValidationError("菜单类型必须填写路由路径");
  }

  return prisma.menu.update({
    where: { id },
    data: {
      parentId: input.parentId !== undefined ? input.parentId : menu.parentId,
      type: nextType,
      name: input.name ?? menu.name,
      // button 类型忽略路由/图标/显示（清空）
      path: isButton ? null : nextPath ?? null,
      component: input.component !== undefined ? input.component : menu.component,
      icon: isButton ? null : input.icon !== undefined ? input.icon : menu.icon,
      sort: input.sort ?? menu.sort,
      visible: isButton ? true : input.visible ?? menu.visible,
      status: input.status ?? menu.status,
    },
  });
}

/**
 * 删除菜单。
 *
 * 依据决策 D2：禁止删除含子节点的菜单（更安全，误删代价低）。
 * 删除后角色-菜单绑定（RoleMenu）因 onDelete: Cascade 自动清理。
 *
 * @param id - 菜单 id
 */
export async function deleteMenu(id: string): Promise<void> {
  const menu = await prisma.menu.findUnique({ where: { id } });
  if (!menu) {
    throw new MenuValidationError("菜单不存在", 404);
  }

  const childCount = await prisma.menu.count({ where: { parentId: id } });
  if (childCount > 0) {
    throw new MenuValidationError("请先删除子菜单");
  }

  await prisma.menu.delete({ where: { id } });
}
