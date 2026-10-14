/**
 * ============================================
 * useThinkingPreference —— 深度思考开关偏好（子应用版）
 * ============================================
 *
 * 【两层控制】
 * - available：全局能力是否开放，读主应用配置中心的 switch.deep_thinking
 *   （通过 utils/app-config.ts 注入的取值函数读取，管理员可熔断）；
 * - enabled  ：用户自己的偏好，记在子应用自己的 localStorage。
 *
 * effective = available && enabled，才是真正下发给后端的值。
 *
 * 【与主应用同名 hook 的差异】
 * 子应用是纯客户端 SPA（Vite，无 SSR），不存在首屏水合问题，
 * 因此可以直接用 useState 的惰性初始化读 localStorage，不必上
 * useSyncExternalStore；读取配置也不进 state，每次渲染现读（O(1) 查表），
 * 这样管理员改完开关能立刻生效、无需刷新。
 */

import { useCallback, useState } from "react";
import { getConfigSwitch } from "../utils/app-config";

/** localStorage 中的偏好键（子应用独立存储，不与主应用混用） */
const STORAGE_KEY = "resume_optimizer_thinking";

/** 用户从未设置过时的默认状态（与主应用保持一致：默认关，用户主动开） */
const DEFAULT_ENABLED = false;

/** 从 localStorage 读偏好；异常（隐私模式）时回退默认值 */
function readStoredPreference(): boolean {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw === null ? DEFAULT_ENABLED : raw === "1";
  } catch {
    return DEFAULT_ENABLED;
  }
}

export interface ThinkingPreference {
  /** 全局能力是否开放（配置项 switch.deep_thinking） */
  available: boolean;
  /** 用户偏好 */
  enabled: boolean;
  /** 实际下发给后端、并驱动 UI 的最终值 */
  effective: boolean;
  /** 修改用户偏好 */
  setEnabled: (next: boolean) => void;
}

export function useThinkingPreference(): ThinkingPreference {
  // 用户偏好：惰性初始化只读一次
  const [enabled, setEnabledState] = useState<boolean>(readStoredPreference);

  // 全局开关：每次渲染现读主应用配置，保证管理员改完即时生效
  const available = getConfigSwitch("switch.deep_thinking", true);

  const setEnabled = useCallback((next: boolean) => {
    setEnabledState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    } catch {
      // 隐私模式 / 配额满：仅内存生效，不阻断交互
    }
  }, []);

  return {
    available,
    enabled,
    // 全局熔断关掉时，用户偏好一律不生效
    effective: available && enabled,
    setEnabled,
  };
}
