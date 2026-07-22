/**
 * App.tsx —— AI简历优化子应用根组件
 *
 * 【职责】
 * 作为子应用的根组件，负责：
 * 1. 提供全局 Ant Design 配置（ConfigProvider + App 组件包裹）
 * 2. 提供认证状态上下文（AuthProvider，所有子组件可通过 useAuth() 获取 token）
 * 3. 提供路由守卫（AuthGuard，独立模式下未登录自动显示登录页）
 * 4. 渲染简历优化主页面组件
 *
 * 【Token 共享流程】
 * main.tsx 的 render() → <App initialToken={props.token} />
 *   → AuthProvider 接收 initialToken 初始化状态
 *     → AuthGuard 检查是否登录
 *       → 已登录 → 渲染业务页面
 *       → 未登录 + qiankun 模式 → 提示"请在主应用登录"
 *       → 未登录 + 独立模式 → 渲染 <SubLogin />
 *
 * 【样式说明】
 * 子应用不引入 Tailwind CSS，所有样式通过 Ant Design 组件 + 内联/CSS Module 实现。
 * 这样可以避免与主应用的 Tailwind 样式冲突，保持子应用的独立性。
 */

import React from "react";
import { ConfigProvider, App as AntdApp } from "antd";
import zhCN from "antd/locale/zh_CN";
import { AuthProvider } from "./contexts/AuthContext";
import AuthGuard from "./components/AuthGuard";
import ResumeOptimizationPage from "./pages/ResumeOptimization";

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
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: "#1677ff",
          borderRadius: 6,
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
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
