/**
 * ============================================
 * Auth Context —— 认证状态上下文
 * ============================================
 *
 * 【职责】
 * 为子应用的所有组件提供统一的认证状态和 Token 操作方法。
 *
 * 【使用方式】
 * <AuthProvider>           ← 包裹在 App.tsx 根层级
 *   <AuthGuard>            ← 路由守卫（无 Token 跳登录）
 *     <YourPage />         ← 通过 useAuth() 获取认证状态
 *   </AuthGuard>
 * </AuthProvider>
 *
 * 【提供的值】
 * useAuth() 返回：
 *   { token, isLoggedIn, isInQiankun, setToken, removeToken }
 */

import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import {
  getToken as getAuthToken,
  setToken as setAuthToken,
  removeToken as removeAuthToken,
  isInQiankun as checkIsQiankun,
} from "../utils/auth";

// ============================================================
// 类型定义
// ============================================================

interface AuthState {
  /** 当前 Token（null 表示未登录） */
  token: string | null;
  /** 是否已登录 */
  isLoggedIn: boolean;
  /** 是否在 qiankun 环境中 */
  isInQiankun: boolean;
  /** 存储 Token */
  setToken: (token: string) => void;
  /** 清除 Token（退出登录） */
  removeToken: () => void;
}

// ============================================================
// Context + Provider
// ============================================================

const AuthContext = createContext<AuthState | null>(null);

/**
 * AuthProvider 组件
 *
 * 应在 App.tsx 根层级使用，包裹所有子组件。
 * 管理认证状态，提供给 useAuth() Hook 消费。
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setTokenState] = useState<string | null>(() => {
    // 初始化时尝试从 token 工具获取（可能是主应用传入的，也可能是 localStorage 的）
    return getAuthToken();
  });

  const [inQiankun] = useState(() => checkIsQiankun());

  /**
   * 存储 Token
   *
   * 调用 utils/auth 的 setToken（环境自适应），同时更新 Context 状态。
   */
  const handleSetToken = useCallback((newToken: string) => {
    setAuthToken(newToken);
    setTokenState(newToken);
  }, []);

  /**
   * 清除 Token
   *
   * 调用 utils/auth 的 removeToken（环境自适应），同时更新 Context 状态。
   */
  const handleRemoveToken = useCallback(() => {
    removeAuthToken();
    setTokenState(null);
  }, []);

  const value: AuthState = {
    token,
    isLoggedIn: !!token,
    isInQiankun: inQiankun,
    setToken: handleSetToken,
    removeToken: handleRemoveToken,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

/**
 * useAuth Hook
 *
 * 在任意子组件中调用，获取当前认证状态和操作方法。
 *
 * @throws 如果在 AuthProvider 外部调用，抛出明确错误
 */
export function useAuth(): AuthState {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error(
      "useAuth 必须在 AuthProvider 内部使用。请检查 App.tsx 中是否正确包裹了 <AuthProvider>"
    );
  }

  return context;
}
