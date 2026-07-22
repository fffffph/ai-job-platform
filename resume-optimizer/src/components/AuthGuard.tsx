/**
 * ============================================
 * AuthGuard —— 认证路由守卫
 * ============================================
 *
 * 【职责】
 * 检查是否已登录，未登录时重定向到登录页。
 *
 *   qiankun 模式 → 未登录时显示提示（通常不会发生，主应用已处理登录）
 *   独立模式   → 未登录时渲染 <SubLogin /> 独立登录页
 *
 * 【使用方式】
 * <AuthProvider>
 *   <AuthGuard>
 *     <YourPage />
 *   </AuthGuard>
 * </AuthProvider>
 */

import React from "react";
import { useAuth } from "../contexts/AuthContext";
import SubLogin from "../pages/SubLogin";

/**
 * 认证守卫组件
 *
 * 业务页面（如 ResumeOptimization）应包裹在 AuthGuard 内部。
 * 这样页面组件可以直接用 useAuth() 获取 token 并注入到 API 请求中，
 * 不需要自己检查登录状态。
 */
const AuthGuard: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isLoggedIn, isInQiankun, token, setToken } = useAuth();

  // ---------- 已登录 → 渲染子组件 ----------
  if (isLoggedIn) {
    return <>{children}</>;
  }

  // ---------- 未登录 → 区分模式 ----------

  // qiankun 模式：极少出现（主应用已做登录），显示友好提示
  if (isInQiankun) {
    return (
      <div
        style={{
          display: "flex",
          height: "100vh",
          justifyContent: "center",
          alignItems: "center",
          color: "#999",
          fontSize: "16px",
        }}
      >
        请先在主应用中登录后访问此功能
      </div>
    );
  }

  // 独立模式：显示子应用自己的登录页
  return <SubLogin onLoginSuccess={setToken} />;
};

export default AuthGuard;
