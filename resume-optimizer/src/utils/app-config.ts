/**
 * ============================================
 * app-config.ts —— 子应用侧的配置中心读取
 * ============================================
 *
 * 【背景】
 * 主应用（CareerAI）有一套配置中心单例：登录后拉取全部配置项缓存到
 * `window.appConfig`，并提供按 key 取值的能力。此前子应用完全没有读它，
 * 导致「管理员在系统设置里改的开关，在简历优化里一律不生效」。
 *
 * 【怎么打通】
 * 主应用在 loadMicroApp 的 props 里多传一个 `getConfigValue(key, default)`，
 * 子应用在 mount 时通过 initAppConfig 注册（见 main.tsx）。
 *
 * 【为什么传函数而不是配置快照】
 * 传进来的是函数，内部读的是主应用的实时单例，所以管理员改完配置后
 * 子应用下次调用就能拿到新值，不需要主应用重新下发 props。
 *
 * 【独立运行模式】
 * 子应用可以脱离主应用单独启动（npm run dev）。此时拿不到注入函数，
 * 退化为「读同窗口的 window.appConfigGetValueByKey」；再拿不到就用默认值。
 * 也就是说独立模式下所有开关取默认值，不会报错。
 */

/** 主应用注入的取值函数签名（与主应用 getConfigValue 一致） */
export type ConfigGetter = <T = unknown>(key: string, defaultValue: T) => T;

/** 主应用注入的取值函数（qiankun 模式才有） */
let injectedGetter: ConfigGetter | null = null;

/**
 * 注册配置取值函数（由 main.tsx 在 qiankun 模式下调用）。
 *
 * @param getter - 主应用传入的 getConfigValue；未传时清空注入
 */
export function initAppConfig(getter?: ConfigGetter): void {
  injectedGetter = typeof getter === "function" ? getter : null;
}

/** 全局兜底：同窗口下直接读主应用挂在 window 上的便捷函数 */
interface WindowWithAppConfig {
  appConfigGetValueByKey?: <T>(key: string, defaultValue?: T) => T | undefined;
}

/**
 * 按 key 读取配置中心的值。
 *
 * 优先级：主应用注入的函数 → 同窗口的 window.appConfigGetValueByKey → 默认值。
 * 任何一步抛错都静默回退，保证配置读取永远不会阻断业务。
 *
 * @param key          - 配置键（如 "switch.deep_thinking"）
 * @param defaultValue - 读不到时的兜底值
 */
export function getConfigValue<T = unknown>(key: string, defaultValue: T): T {
  if (injectedGetter) {
    try {
      return injectedGetter<T>(key, defaultValue);
    } catch (error) {
      console.warn(`[resume-optimizer] 读取配置 ${key} 失败，已回退默认值`, error);
    }
  }

  try {
    const w = window as unknown as WindowWithAppConfig;
    const value = w.appConfigGetValueByKey?.(key, defaultValue);
    // 注意用 ?? 而不是 ||：false / 0 / "" 都是合法配置值
    return (value ?? defaultValue) as T;
  } catch {
    return defaultValue;
  }
}

/**
 * 读取布尔型功能开关。
 *
 * 单独抽出来是因为「配置项缺失」与「配置为 false」必须区分开：
 * 缺失时用 defaultValue，显式 false 时必须返回 false。
 */
export function getConfigSwitch(key: string, defaultValue = true): boolean {
  const value = getConfigValue<boolean | undefined>(key, undefined);
  return typeof value === "boolean" ? value : defaultValue;
}
