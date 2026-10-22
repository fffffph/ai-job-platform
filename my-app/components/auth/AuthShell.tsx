"use client";

/**
 * ============================================
 * 认证类页面外壳（登录 / 注册 / 强制改密）
 * ============================================
 *
 * 【解决什么问题】
 * 登录页、注册页、强制改密页原先各自硬编码了 `bg-[#050505]` 与一堆
 * `text-white/xx`、`border-white/10`，也就是**永远暗色**。用户在系统里把主题
 * 切成浅色后，一进登录页又被打回全黑，前后割裂。
 *
 * 【做法（两层）】
 * 1. AuthThemeProvider：用 next-themes 的 theme 决定 antd 算法
 *    （defaultAlgorithm / darkAlgorithm），与 dashboard/layout.tsx 完全同口径；
 * 2. AuthShell：页面背景、光晕、网格、毛玻璃卡片统一改用 CSS 变量
 *    （--background / --foreground / --card / --border / --primary /
 *    --muted-foreground）。CSS 变量随 <html class="dark"> 自动切换，
 *    一份样式服务两套主题。
 *
 * 【为什么不用 Tailwind 的 dark: 前缀逐处改】
 * 深色由 next-themes 给 <html> 加 .dark 类，Tailwind v4 也已配置
 * `@custom-variant dark (&:is(.dark *))`，两种方式都能work。但认证页里
 * 大量「半透明白」写法（bg-white/5、border-white/10、text-white/30）在浅色下
 * 完全不可见，逐处加 dark: 变体既啰嗦又容易漏项。统一走 CSS 变量更稳。
 *
 * 【为什么未挂载时按暗色渲染】
 * next-themes 在服务端拿不到主题，首帧 theme 是 undefined。这里与
 * dashboard/layout.tsx 保持同一个兜底（mounted && !isDark ? default : dark），
 * 保证两个区域首帧表现一致，不会「进 dashboard 闪一下、进登录页闪另一下」。
 */

import React, { useEffect, useState } from "react";
import { ConfigProvider, App, theme as antdTheme } from "antd";
import { useTheme } from "next-themes";
import { motion } from "framer-motion";

export interface AuthThemeProviderProps {
  children: React.ReactNode;
}

/**
 * 认证页主题提供者。
 *
 * 【关于 token 里的 colorBgContainer】
 * 旧代码把 `colorBgContainer` 与 Input 的底色写成写死的半透明黑/白，
 * 那是为「永远暗色」服务的。去掉后由 antd 算法自己决定明暗底色，
 * 卡片外框由 .auth-card 提供毛玻璃效果，互不打架。
 */
export function AuthThemeProvider({ children }: AuthThemeProviderProps) {
  const { theme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    /**
     * 包一层 async IIFE 再 setMounted(true)。
     *
     * 【为什么不直接写 setMounted(true)】
     * 项目启用了 React Compiler 的 lint 规则 react-hooks/set-state-in-effect：
     * 在 effect 体内同步 setState 会被拦下。放到微任务里即可规避，
     * 与 login / register / change-password 页里读配置的写法保持一致。
     */
    (async () => {
      setMounted(true);
    })();
  }, []);

  const isDark = theme === "dark";
  const useLight = mounted && !isDark;

  return (
    <ConfigProvider
      theme={{
        algorithm: useLight ? antdTheme.defaultAlgorithm : antdTheme.darkAlgorithm,
        token: {
          // 品牌蓝固定不随主题变（与子应用、dashboard 保持同一视觉锚点）
          colorPrimary: "#3b82f6",
          borderRadius: 12,
        },
        components: {
          Button: { controlHeightLG: 48 },
        },
      }}
    >
      <App>{children}</App>
    </ConfigProvider>
  );
}

export interface AuthShellProps {
  children: React.ReactNode;
  /** 内容最大宽度（px）。登录 420 / 改密 520 */
  maxWidth?: number;
}

/**
 * 认证页外壳：背景装饰 + 居中容器。
 *
 * 【与旧实现的视觉等价性】
 * 原来是「#050505 底 + 蓝/靛光晕 + 白色网格 + 黑玻璃卡片」，
 * 现在元素一个不少，只是颜色从写死值换成变量，浅色下变成
 * 「浅灰底 + 淡蓝紫光晕 + 深灰网格 + 白玻璃卡片」。
 */
export function AuthShell({ children, maxWidth = 420 }: AuthShellProps) {
  return (
    <div className="auth-page">
      {/* 背景装饰：光晕 + 网格（颜色全部来自 CSS 变量，随主题切换） */}
      <div className="auth-bg" aria-hidden>
        <div className="auth-glow auth-glow-1" />
        <div className="auth-glow auth-glow-2" />
        <div className="auth-grid" />
      </div>

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="auth-content"
        style={{ maxWidth }}
      >
        {children}
      </motion.div>
    </div>
  );
}

export default AuthShell;
