/**
 * ============================================
 * 应用级配置 / 角色单例（window 全局缓存）
 * ============================================
 *
 * 【职责】
 * 登录后「拉取一次」当前用户的角色与系统配置，缓存到 window 全局，
 * 供整个前端共享，避免：
 *   1. 每个页面各自请求一次角色/配置（重复网络开销）；
 *   2. 菜单渲染（判断是否管理员）与设置页数据源不一致。
 *
 * 【为什么用 window 而非 React Context / 状态库？】
 * - 用户明确要求「window 单例」：登录后取一次即可，跨路由、跨组件共享；
 * - 数据量小、读多写少，Context 反而要处理 provider 嵌套与刷新传播，
 *   window 单例更简单直接，且可被非 React 代码（如工具函数）访问。
 *
 * 【数据内容】
 * - roles  : 当前用户角色代码（如 ["admin"]），用于菜单权限过滤；
 * - configs: 全部配置项有效状态，供「系统设置」页渲染（也可按需取单值）。
 *
 * 【失效时机】
 * - 用户退出登录 / Token 失效跳转时，应调用 clearAppConfig 清空；
 * - 管理员在设置页保存后，本地写回新值（loadAppConfig(force) 或手动更新）。
 */

import { getMyRoles, getConfigsApi, getMyMenuApi } from "@/api";
import type { EffectiveConfigItem, MenuTreeNode } from "@/api";

// ============================================================
// 类型定义与全局声明
// ============================================================

/** 缓存到 window 的应用配置/角色状态 */
export interface AppConfigState {
  /** 当前用户角色代码数组，如 ["admin"] / ["user"] */
  roles: string[];
  /** 当前用户全部权限码（按钮/菜单级 code），供 hasPermission 使用 */
  permissions: string[];
  /** 当前用户侧边栏菜单树（catalog/menu），供 MainLayout 动态渲染 */
  menus: MenuTreeNode[];
  /** 全部配置项有效状态（按注册表顺序） */
  configs: EffectiveConfigItem[];
  /** 缓存时间戳（毫秒） */
  loadedAt: number;
}

/**
 * 挂到 window.appConfig 上的全局配置对象。
 *
 * 提供 key → value 的直取能力（O(1)），配合 window.appConfigGetValueByKey
 * 供任意代码（含非 React 工具函数）以「key + 默认值」方式读取配置。
 */
export interface AppConfigGlobal {
  /** key → value 映射（由 configs 列表构建） */
  data: Record<string, unknown>;
  /** 按 key 取值，命中返回实际值，否则返回 defaultValue（不存在才兜底） */
  getValueByKey<T = unknown>(key: string, defaultValue: T): T;
}

/** 把自定义属性挂到 window 上（TS 全局声明） */
declare global {
  interface Window {
    __APP_CONFIG__?: AppConfigState | null;
    /** 全局配置对象（含 getValueByKey 方法） */
    appConfig?: AppConfigGlobal | null;
    /** 便捷取值函数：window.appConfigGetValueByKey(key, default) */
    appConfigGetValueByKey?: <T = unknown>(
      key: string,
      defaultValue?: T
    ) => T | undefined;
  }
}

// ============================================================
// 读取 / 加载 / 清空
// ============================================================

/**
 * 同步读取缓存的配置/角色（无网络请求，可能为 null）。
 *
 * 优先用这个，避免在服务端（SSR）访问 window 报错。
 */
export function getAppConfig(): AppConfigState | null {
  if (typeof window === "undefined") return null;
  return window.__APP_CONFIG__ ?? null;
}

/**
 * 加载（或强制刷新）应用配置与角色，并缓存到 window。
 *
 * - 已有缓存且未强制 → 直接返回缓存，不重复请求；
 * - force=true → 强制重新拉取（设置页保存后刷新、登录后首次加载等）。
 *
 * 两个请求并行（Promise.all），失败时静默降级（roles 空、configs 空），
 * 不抛异常、不阻塞页面。
 *
 * @param force - 是否强制重新拉取（默认 false）
 */
export async function loadAppConfig(
  force: boolean = false
): Promise<AppConfigState | null> {
  if (typeof window === "undefined") return null;

  // 命中缓存且不强制 → 直接返回
  if (!force && window.__APP_CONFIG__) {
    return window.__APP_CONFIG__;
  }

  // 并行拉取角色 + 权限菜单 + 配置，失败各自降级为空
  const [rolesRes, menuRes, configsRes] = await Promise.all([
    getMyRoles(),
    getMyMenuApi(),
    getConfigsApi(),
  ]);

  const state: AppConfigState = {
    roles: rolesRes.success && rolesRes.data ? rolesRes.data.roles : [],
    permissions:
      menuRes.success && menuRes.data ? menuRes.data.permissions : [],
    menus: menuRes.success && menuRes.data ? menuRes.data.menus : [],
    configs: configsRes.success && configsRes.data ? configsRes.data : [],
    loadedAt: Date.now(),
  };

  window.__APP_CONFIG__ = state;
  // 同步挂载 window.appConfig / window.appConfigGetValueByKey（取值函数）
  syncAppConfigGlobal(state);
  return state;
}

/**
 * 清空缓存（退出登录 / Token 失效时调用，防止角色越权残留）。
 */
export function clearAppConfig(): void {
  if (typeof window === "undefined") return;
  window.__APP_CONFIG__ = null;
  window.appConfig = null;
  window.appConfigGetValueByKey = undefined;
}

// ============================================================
// 全局取值函数（window.appConfigGetValueByKey）
// ============================================================

/**
 * 把配置列表转成 key → value 的映射（供 getValueByKey O(1) 直取）。
 */
function buildConfigData(configs: EffectiveConfigItem[]): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const item of configs) {
    data[item.key] = item.value;
  }
  return data;
}

/**
 * 同步 window.appConfig 与 window.appConfigGetValueByKey。
 *
 * 在 loadAppConfig 成功后调用一次；管理员保存配置后刷新 window 单例时
 * 也会随 loadAppConfig(force) 重建，保证取值函数拿到最新值。
 */
function syncAppConfigGlobal(state: AppConfigState): void {
  if (typeof window === "undefined") return;

  const data = buildConfigData(state.configs);

  window.appConfig = {
    data,
    // key 命中（含值为 false/0/"" 时）返回实际值；只有 key 不存在才走 defaultValue
    getValueByKey(key, defaultValue) {
      return key in this.data ? (this.data[key] as typeof defaultValue) : defaultValue;
    },
  };

  // 便捷函数：任意代码（含非 React 工具函数）直接调用
  window.appConfigGetValueByKey = (key, defaultValue = undefined) => {
    // 用 ?? 而非 ||：保证 false/0/"" 等合法值不被误吞为默认值
    return window.appConfig?.getValueByKey(key, defaultValue) ?? defaultValue;
  };
}

/**
 * 模块导出版「按 key 取值」（供 React 组件 import 使用，内部读 window.appConfig）。
 *
 * 与 window.appConfigGetValueByKey 等价，但走模块导入，类型更友好。
 * 注意：需先 loadAppConfig() 登录后取一次，否则返回 defaultValue。
 */
export function getConfigValue<T = unknown>(
  key: string,
  defaultValue: T
): T {
  if (typeof window === "undefined") return defaultValue;
  return (window.appConfig?.getValueByKey(key, defaultValue) ?? defaultValue) as T;
}

// ============================================================
// 权限判断辅助
// ============================================================

/**
 * 判断是否管理员。
 *
 * - 传 roles 时按传入值判断；
 * - 不传时读 window 缓存（可能为空 → 返回 false，保守处理）。
 */
export function isAdmin(roles?: string[]): boolean {
  const r = roles ?? getAppConfig()?.roles ?? [];
  return r.includes("admin");
}

/**
 * 判断当前用户是否拥有指定权限码。
 *
 * 【判定规则】
 * 1. window 单例未加载 → 保守返回 false（无缓存不越权）；
 * 2. admin 角色 → 恒 true（后端 admin 短路，前端 UI 保持一致）；
 * 3. permissions 命中该 code → true；
 * 4. 菜单树中存在 code 相同的节点（目录/菜单级 code）→ true。
 *
 * 说明：permissions 同时包含菜单级与按钮级 code，故本函数既可用于
 * 按钮显隐（system:user:grant），也可用于目录/页面级守卫（system）。
 *
 * @param code - 权限码（引用 PERMISSIONS 常量）
 * @returns 是否拥有权限
 */
export function hasPermission(code: string): boolean {
  const state = getAppConfig();
  if (!state) return false;

  // admin 恒 true（与后端 isAdminRole 短路保持一致）
  if (state.roles.includes("admin")) return true;

  // 权限码直接命中
  if (state.permissions.includes(code)) return true;

  // 目录/菜单级 code 兜底：菜单树中存在同 code 节点
  return menuTreeHasCode(state.menus, code);
}

/**
 * 递归判断菜单树中是否存在指定 code 的节点。
 */
function menuTreeHasCode(nodes: MenuTreeNode[], code: string): boolean {
  for (const node of nodes) {
    if (node.code === code) return true;
    if (node.children && node.children.length > 0 && menuTreeHasCode(node.children, code)) {
      return true;
    }
  }
  return false;
}
