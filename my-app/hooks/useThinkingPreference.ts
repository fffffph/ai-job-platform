"use client";

/**
 * ============================================
 * useThinkingPreference —— 「深度思考」开关偏好
 * ============================================
 *
 * 【职责】
 * 给业务组件提供「本次要不要开启深度思考」的三件套：
 * - available：全局能力是否开放（读配置中心 switch.deep_thinking，管理员可熔断）；
 * - enabled  ：用户自己的偏好（记在 localStorage，下次访问还记得）；
 * - effective：真正该下发给后端的值 = available && enabled。
 *
 * 【为什么是两层而不是一层】
 * 全局开关是「熔断」而不是「默认值」：管理员关掉后，用户勾了也不生效
 * （防止成本失控）；用户偏好则是「省得每次都要重新勾」。
 *
 * 【为什么用 useSyncExternalStore 读 localStorage】
 * 直接用 useState + useEffect 读 localStorage 有两个问题：
 * 1. SSR 首屏拿不到 localStorage，服务端与客户端首帧不一致会有水合告警；
 * 2. 在 effect 体内同步 setState 会触发 react-hooks/set-state-in-effect。
 * useSyncExternalStore 正是 React 官方为「订阅外部可变数据源」提供的 API：
 * 它用 getServerSnapshot 保证服务端渲染稳定，客户端水合后再对齐真实值。
 *
 * 【默认值决策点（D1）】
 * DEFAULT_ENABLED 决定「用户从未设置过时，开关是开还是关」。
 * 当前取 false：让用户主动开启，这样「打开开关 → 看到它在思考 → 答案更细」
 * 的因果对比才成立；同时默认不思考可省下思考的 token 与等待时间。
 * 若产品上希望默认就思考，把这一行改成 true 即可。
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { getAppConfig, getConfigValue, loadAppConfig } from "@/lib/app-config";

/** localStorage 中的偏好键 */
const STORAGE_KEY = "careerai:thinking:enabled";

/** 配置中心里的全局熔断开关（server/src/config/schema.ts） */
const CONFIG_KEY = "switch.deep_thinking";

/** 用户从未设置过时的默认状态（D1 决策点，见文件头注释） */
const DEFAULT_ENABLED = false;

// ============================================================
// localStorage 外部数据源（供 useSyncExternalStore 订阅）
// ============================================================

/** 订阅者集合（写入偏好后通知 React 重新读取） */
const listeners = new Set<() => void>();

/** 当前快照缓存：布尔原始值，返回引用天然稳定 */
let snapshot: boolean = DEFAULT_ENABLED;

/** 从 localStorage 读偏好；读不到或异常（隐私模式）时回退默认值 */
function readFromStorage(): boolean {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw === null ? DEFAULT_ENABLED : raw === "1";
  } catch {
    return DEFAULT_ENABLED;
  }
}

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

function getSnapshot(): boolean {
  // 每次读都对齐真实存储：首次客户端渲染即可拿到用户此前的选择，
  // 无需借助 effect（否则会触发 set-state-in-effect）。
  const stored = readFromStorage();
  if (stored !== snapshot) {
    snapshot = stored;
  }
  return snapshot;
}

/** 服务端渲染 / 水合阶段返回的稳定快照 */
function getServerSnapshot(): boolean {
  return DEFAULT_ENABLED;
}

/** 写入偏好并通知所有订阅者 */
function writePreference(next: boolean): void {
  snapshot = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
  } catch {
    // 隐私模式 / 存储配额满：仅内存生效，不阻断交互
  }
  listeners.forEach((notify) => notify());
}

// ============================================================
// Hook
// ============================================================

export interface ThinkingPreference {
  /** 全局能力是否开放（配置项 switch.deep_thinking） */
  available: boolean;
  /** 用户偏好（localStorage） */
  enabled: boolean;
  /** 实际下发给后端、并驱动 UI 的最终值 */
  effective: boolean;
  /** 修改用户偏好 */
  setEnabled: (next: boolean) => void;
}

export function useThinkingPreference(): ThinkingPreference {
  const enabled = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  /**
   * 全局能力开关。
   *
   * 初值从 window 配置单例读：该单例由 dashboard/layout 在登录后拉取，
   * 若尚未就绪则回退 true（乐观放行），随后由下面的 effect 校正。
   */
  const [available, setAvailable] = useState<boolean>(
    // 显式传泛型 <boolean>：否则 T 会被推断为字面量 true，与 false 比较会被 TS 判为无意义
    () => getConfigValue<boolean>(CONFIG_KEY, true) !== false
  );

  useEffect(() => {
    // 配置单例已加载：初值就是准的，无需再校正
    if (getAppConfig()) return;

    let cancelled = false;
    // 在回调里 setState（而非 effect 体内同步 setState），避免级联渲染
    void loadAppConfig().then(() => {
      if (cancelled) return;
      setAvailable(getConfigValue<boolean>(CONFIG_KEY, true) !== false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const setEnabled = useCallback((next: boolean) => {
    writePreference(next);
  }, []);

  return {
    available,
    enabled,
    // 全局熔断关掉时，用户偏好一律不生效
    effective: available && enabled,
    setEnabled,
  };
}
