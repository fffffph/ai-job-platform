/**
 * ============================================
 * Axios 请求客户端 — 统一入口 + 拦截器
 * ============================================
 *
 * 【架构说明】
 * 整个前端只有一个 axios 实例（单例模式），
 * 所有 API 调用都通过此实例发送，确保：
 * 1. 统一的请求/响应拦截处理（Token 注入、错误兜底）
 * 2. 统一的超时时间、baseURL 配置
 * 3. 所有请求都走一层日志和错误处理
 *
 * 【Token 管理策略】
 * - 登录/注册成功后，Token 存入 localStorage
 * - 每次请求前，从 localStorage 读取 Token 并注入 Authorization 头
 * - 路由守卫检查 Token 是否存在，不存在则跳转登录页
 *
 * 【错误处理策略（响应拦截器）】
 * - 401 → 清除 Token，跳转登录页
 * - 网络错误 → 提示"网络异常"
 * - 超时 → 提示"请求超时"
 * - 其他错误 → 透传给调用方自行处理
 *
 * 【使用示例】
 * ```ts
 * import client from "@/api/client";
 * const res = await client.post("/api/auth/login", { email, password });
 * ```
 */

import axios, { type AxiosInstance, type AxiosError } from "axios";

// ============================================================
// 常量配置
// ============================================================

/** Token 在 localStorage 中的 key */
const TOKEN_KEY = "careerai_token";

/** 请求超时时间（毫秒） */
const REQUEST_TIMEOUT = 15000;

// ============================================================
// Token 工具函数
// ============================================================

/**
 * 从 localStorage 读取 Token
 *
 * 封装成函数的好处：
 * 1. 解耦存储方式（未来改 sessionStorage/cookie 只需改这里）
 * 2. 统一异常处理（JSON.parse 失败时返回 null）
 */
export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

/** 存储 Token 到 localStorage */
export function setToken(token: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(TOKEN_KEY, token);
}

/** 清除 Token（退出登录时调用） */
export function removeToken(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(TOKEN_KEY);
}

// ============================================================
// 创建 Axios 实例
// ============================================================

const client: AxiosInstance = axios.create({
  /**
   * baseURL 配置
   *
   * 开发环境下指向后端 Express 服务器（:4000），
   * 生产环境通过环境变量配置或使用相对路径（同域部署）。
   */
  baseURL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000",

  /** 请求超时 */
  timeout: REQUEST_TIMEOUT,

  /** 默认请求头 */
  headers: {
    "Content-Type": "application/json",
  },
});

// ============================================================
// 请求拦截器（Request Interceptor）
// ============================================================

/**
 * 请求发送前的处理
 *
 * 在这里做的事：
 * 1. 注入 Authorization Token
 * 2. 记录请求日志（开发环境）
 */
client.interceptors.request.use(
  (config) => {
    // ---------- 注入 Token ----------
    const token = getToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    // ---------- 开发环境日志 ----------
    if (process.env.NODE_ENV === "development") {
      console.log(
        `[API] ${config.method?.toUpperCase()} ${config.url}`,
        config.data || ""
      );
    }

    return config;
  },
  (error) => {
    // 请求配置错误极少发生，直接抛出
    return Promise.reject(error);
  }
);

// ============================================================
// 响应拦截器（Response Interceptor）
// ============================================================

/**
 * 响应接收后的统一处理
 *
 * 在这里做的事：
 * 1. 成功响应：直接返回 response.data（调用方只关心业务数据）
 * 2. 401 错误：清除 Token，跳转登录页
 * 3. 网络/超时错误：给出友好提示
 * 4. 其他错误：透传错误信息，调用方自行按 code 处理
 */
client.interceptors.response.use(
  // ---------- 成功响应 ----------
  (response) => {
    // 直接返回响应体（调用方不需要处理 axios 的包装层）
    return response.data;
  },

  // ---------- 失败响应 ----------
  (error: AxiosError<{ message?: string; code?: string }>) => {
    // 服务器返回了错误响应（有 response 对象）
    if (error.response) {
      const { status, data } = error.response;

      // 401 Unauthorized — Token 失效或未登录
      if (status === 401) {
        removeToken();
        // 不是登录/注册页面才跳转（避免死循环）
        if (
          typeof window !== "undefined" &&
          !window.location.pathname.startsWith("/login") &&
          !window.location.pathname.startsWith("/register")
        ) {
          window.location.href = "/login";
        }
      }

      // 透传服务端错误信息，调用方自行处理
      return Promise.reject({
        success: false,
        message: data?.message || `请求失败 (${status})`,
        code: data?.code || `HTTP_${status}`,
      });

      // ---------- 网络/超时错误（请求根本没到达服务器）----------
    } else if (error.request) {
      if (error.code === "ECONNABORTED") {
        return Promise.reject({
          success: false,
          message: "请求超时，请检查网络后重试",
          code: "TIMEOUT",
        });
      }

      return Promise.reject({
        success: false,
        message: "网络异常，请检查网络连接",
        code: "NETWORK_ERROR",
      });

      // ---------- 其他未知错误 ----------
    } else {
      return Promise.reject({
        success: false,
        message: error.message || "未知错误",
        code: "UNKNOWN",
      });
    }
  }
);

export default client;
