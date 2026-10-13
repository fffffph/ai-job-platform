/**
 * ============================================
 * 菜单树工具（后端菜单树 → Antd Menu items）
 * ============================================
 *
 * 【职责】
 * 把后端 GET /api/menu/my 返回的菜单树（MenuTreeNode[]）映射为
 * Antd Menu 的 items 结构，并计算当前路由对应的「选中项 / 展开项」。
 *
 * 【key 约定】
 * - 叶子节点（menu）：key = path（用于 router.push 导航；无 path 时降级为 leaf:code）；
 * - 父节点（catalog / 含子节点）：key = `cat:{code}`（仅展开/收起，不导航）。
 *
 * 【选中/展开】
 * - 用 pathname 前缀匹配，选中「最长匹配」的叶子；
 * - 展开项为其所有祖先目录，保证 /dashboard/system/* 下目录保持展开高亮。
 */

import type { MenuProps } from "antd";
import { createElement } from "react";
import type { MenuTreeNode } from "@/api";
import { getMenuIcon } from "./menu-icons";

/** Antd Menu items 的元素类型 */
type AntdMenuItem = Required<MenuProps>["items"][number];

/** 扁平化后的菜单节点（用于计算选中/展开） */
interface FlatMenu {
  /** 节点 key（与 buildMenuItems 保持一致） */
  key: string;
  /** 路由路径（目录为 null） */
  path: string | null;
  /** 祖先目录 key 列表 */
  parentKeys: string[];
}

/**
 * 生成目录/父节点的 key。
 */
function toCatalogKey(code: string): string {
  return `cat:${code}`;
}

/**
 * 生成叶子节点的 key（优先 path，无 path 时降级为 leaf:code）。
 */
function toLeafKey(node: MenuTreeNode): string {
  return node.path || `leaf:${node.code}`;
}

/**
 * 递归把菜单树转换为 Antd Menu 的 items。
 *
 * @param nodes - 后端菜单树
 * @returns Antd MenuProps['items']
 */
export function buildMenuItems(nodes: MenuTreeNode[]): AntdMenuItem[] {
  return nodes.map((node) => {
    // 本文件为 .ts（无 JSX），用 createElement 构造图标元素
    const icon = createElement(getMenuIcon(node.icon));
    const hasChildren = !!(node.children && node.children.length > 0);

    // 含子节点 → 渲染为可展开子菜单（点击标题仅展开/收起）
    if (hasChildren) {
      return {
        key: toCatalogKey(node.code),
        icon,
        label: node.name,
        children: buildMenuItems(node.children!),
      } as AntdMenuItem;
    }

    // 叶子节点 → 点击按 path 导航
    return {
      key: toLeafKey(node),
      icon,
      label: node.name,
    } as AntdMenuItem;
  });
}

/**
 * 递归扁平化菜单树（携带祖先 key 链）。
 */
function flatten(nodes: MenuTreeNode[], parentKeys: string[] = []): FlatMenu[] {
  const out: FlatMenu[] = [];
  for (const node of nodes) {
    const hasChildren = !!(node.children && node.children.length > 0);
    const key = hasChildren ? toCatalogKey(node.code) : toLeafKey(node);
    out.push({ key, path: node.path ?? null, parentKeys });
    if (hasChildren) {
      out.push(...flatten(node.children!, [...parentKeys, key]));
    }
  }
  return out;
}

/**
 * 计算当前路由对应的「选中项 + 展开目录」。
 *
 * 用 pathname 前缀匹配所有带 path 的叶子，取最长匹配者为选中项，
 * 其祖先目录为展开项（保证子路由下目录高亮展开）。
 *
 * @param pathname - 当前路由（next/navigation usePathname）
 * @param nodes    - 后端菜单树
 * @returns { selectedKeys, openKeys }
 */
export function resolveMenuState(
  pathname: string,
  nodes: MenuTreeNode[]
): { selectedKeys: string[]; openKeys: string[] } {
  const flat = flatten(nodes);

  let selectedKey = "";
  let openKeys: string[] = [];
  let bestLen = -1;

  for (const f of flat) {
    if (f.path && pathname.startsWith(f.path) && f.path.length > bestLen) {
      bestLen = f.path.length;
      selectedKey = f.key;
      openKeys = f.parentKeys;
    }
  }

  return {
    selectedKeys: selectedKey ? [selectedKey] : [],
    openKeys,
  };
}

/**
 * 仅取「当前路由应展开的目录 key」列表（resolveMenuState 的便捷封装）。
 */
export function findOpenKeys(pathname: string, nodes: MenuTreeNode[]): string[] {
  return resolveMenuState(pathname, nodes).openKeys;
}
