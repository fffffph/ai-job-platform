/**
 * useSubAppTheme —— 子应用主题感知 Hook
 *
 * 【职责】
 * 子应用挂在主应用 <body> 内的容器里，并不是 <html>，但 next-themes
 * 切主题时是给 <html> 加 / 移除 `.dark` 类。CSS 变量基于 .dark 选择器
 * 会自动向下传递到所有后代元素，所以 CSS 层不需要我们做任何事。
 *
 * 这里只负责告诉 Ant Design 切换 darkAlgorithm/defaultAlgorithm，
 * 以及提供一个 useTheme() 风格的 isDark 给个别组件使用。
 */

import { useEffect, useState } from "react";

/**
 * 读取当前主题模式
 *
 * @returns "dark" | "light" | "system"
 *
 * 【实现说明】
 * - 直接读 <html> 的 className（next-themes 的 attribute="class" 模式）
 * - MutationObserver 监听 className 变化触发组件重渲染
 * - 返回 "system" 时需要再看 prefers-color-scheme
 */
function readThemeMode(): "dark" | "light" | "system" {
  if (typeof document === "undefined") return "light";
  const root = document.documentElement;
  if (root.classList.contains("dark")) return "dark";
  if (root.classList.contains("light")) return "light";
  return "system";
}

/**
 * 当模式为 system 时，根据 OS 偏好决定实际生效。
 */
function resolveEffectiveTheme(mode: "dark" | "light" | "system"): "dark" | "light" {
  if (mode === "system") {
    if (typeof window === "undefined") return "light";
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    return prefersDark ? "dark" : "light";
  }
  return mode;
}

/**
 * 子应用主题 Hook
 *
 * @returns { isDark } - 当前是否处于暗色模式
 *
 * @example
 * const { isDark } = useSubAppTheme();
 * <ConfigProvider theme={{ algorithm: isDark ? darkAlgorithm : defaultAlgorithm }}>
 */
export function useSubAppTheme(): { isDark: boolean } {
  const [mode, setMode] = useState<"dark" | "light" | "system">(readThemeMode);
  const [systemDark, setSystemDark] = useState<boolean>(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches,
  );

  // ---------- 监听 <html> class 变化（next-themes 切主题） ----------
  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      setMode(readThemeMode());
    });
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  // ---------- 监听 OS 主题（system 模式下用） ----------
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  const isDark = resolveEffectiveTheme(mode) === "dark";
  return { isDark };
}
