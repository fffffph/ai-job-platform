/**
 * ============================================
 * 菜单图标映射（图标名 → Antd 图标组件）
 * ============================================
 *
 * 【职责】
 * 后端菜单的 icon 字段是「字符串」（如 dashboard / team），
 * 本模块维护「字符串 → React 图标组件」映射，供侧边栏与图标选择器使用。
 *
 * 【约定】
 * - 未知图标名降级为默认图标（AppstoreOutlined），绝不报错；
 * - ICON_NAMES 供菜单管理页的「图标选择器」下拉展示。
 */

import React from "react";
import {
  DashboardOutlined,
  ProjectOutlined,
  FileTextOutlined,
  UserOutlined,
  HistoryOutlined,
  SettingOutlined,
  MenuOutlined,
  TeamOutlined,
  UsergroupAddOutlined,
  AppstoreOutlined,
} from "@ant-design/icons";

/** 图标名 → Antd 图标组件 映射表 */
export const ICON_MAP: Record<string, React.ComponentType> = {
  /** 工作台 */
  dashboard: DashboardOutlined,
  /** 职位发现 */
  project: ProjectOutlined,
  /** 简历优化 */
  "file-text": FileTextOutlined,
  /** 个人中心 */
  user: UserOutlined,
  /** 决策历史 */
  history: HistoryOutlined,
  /** 系统设置 / 基础配置 */
  setting: SettingOutlined,
  /** 菜单管理 */
  menu: MenuOutlined,
  /** 角色管理 */
  team: TeamOutlined,
  /** 用户管理 */
  usergroup: UsergroupAddOutlined,
};

/** 可选图标名列表（供图标选择器下拉） */
export const ICON_NAMES: string[] = Object.keys(ICON_MAP);

/** 默认（降级）图标 */
const DEFAULT_ICON = AppstoreOutlined;

/**
 * 根据图标名获取 Antd 图标组件（未知降级为默认图标）。
 *
 * @param name - 图标名（如 dashboard / team），可为 null / 未知值
 * @returns React 图标组件
 */
export function getMenuIcon(name?: string | null): React.ComponentType {
  if (!name) return DEFAULT_ICON;
  return ICON_MAP[name] ?? DEFAULT_ICON;
}
