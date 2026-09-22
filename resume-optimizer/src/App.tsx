/**
 * App.tsx —— AI简历优化子应用根组件
 *
 * 【职责】
 * 作为子应用的根组件，负责：
 * 1. 注入全局 CSS（含暗色主题变量）
 * 2. 提供全局 Ant Design 配置（ConfigProvider + App 组件包裹）
 *    - 通过 useSubAppTheme 监听父级主题，切换 algorithm
 * 3. 提供认证状态上下文（AuthProvider，所有子组件可通过 useAuth() 获取 token）
 * 4. 提供路由守卫（AuthGuard，独立模式下未登录自动显示登录页）
 * 5. 渲染简历优化主页面组件
 *
 * 【Token 共享流程】
 * main.tsx 的 render() → <App initialToken={props.token} />
 *   → AuthProvider 接收 initialToken 初始化状态
 *     → AuthGuard 检查是否登录
 *       → 已登录 → 渲染业务页面
 *       → 未登录 + qiankun 模式 → 提示"请在主应用登录"
 *       → 未登录 + 独立模式 → 渲染 <SubLogin />
 *
 * 【主题适配说明】
 * 子应用挂在主应用页面里，主应用通过 next-themes 控制 <html> 上的
 * .dark / .light 类。CSS 变量已经在 globals.css 中按 .dark 与 :root 双套
 * 定义，我们这里通过 useSubAppTheme 同步切换 Ant Design 的 algorithm：
 *   - light → defaultAlgorithm  Component 走浅色变量
 *   - dark  → darkAlgorithm    Component 走深色变量
 *
 * 子应用代码统一使用 var(--bg-card) / var(--text-1) 等 CSS 变量取色，
 * 实现真正的明暗模式自动响应。
 */

import React from "react";
import { ConfigProvider, App as AntdApp, theme as antdTheme } from "antd";
import zhCN from "antd/locale/zh_CN";
import { AuthProvider } from "./contexts/AuthContext";
import AuthGuard from "./components/AuthGuard";
import ResumeOptimizationPage from "./pages/ResumeOptimization";
import { useSubAppTheme } from "./hooks/useSubAppTheme";
import "./styles/globals.css";

/**
 * 子应用根组件
 *
 * 层级结构：
 * ConfigProvider (Ant Design 主题)
 *   → AntdApp (message/notification/modal 上下文)
 *     → AuthProvider (认证状态上下文 ▸ 从 utils/auth.ts 读取 token)
 *       → AuthGuard (路由守卫 ▸ 无 token 时显示登录页)
 *         → ResumeOptimizationPage (业务页面)
 */
const App: React.FC = () => {
  // 监听主应用传下来的主题变化（<html> 上的 dark/light 类）
  const { isDark } = useSubAppTheme();

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: {
          colorPrimary: "#3b82f6",
          borderRadius: 8,
          colorBgContainer: "var(--bg-card)",
          colorBgElevated: "var(--bg-elevated)",
          colorBgLayout: "var(--bg-page)",
          colorText: "var(--text-1)",
          colorTextSecondary: "var(--text-2)",
          colorBorder: "var(--border-1)",
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
        },
      }}
    >
      <AntdApp>
        <AuthProvider>
          <AuthGuard>
            <ResumeOptimizationPage />
          </AuthGuard>
        </AuthProvider>
      </AntdApp>
    </ConfigProvider>
  );
};

export default App;
