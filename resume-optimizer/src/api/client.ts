/**
 * ============================================
 * 子应用 Axios 客户端（与主应用模式统一）
 * ============================================
 *
 * 【与主应用 api/client.ts 的差异】
 * 1. baseURL → http://localhost:4000（Express 后端）
 * 2. TOKEN_KEY → careerai_token（与主应用一致）
 * 3. Token 优先从 utils/auth 获取（支持主应用注入）
 * 4. 拦截器逻辑与主应用完全一致
 */

import axios, { type AxiosInstance, type AxiosError } from "axios";
import { getToken, removeToken as clearAuthToken } from "../utils/auth";

const REQUEST_TIMEOUT = 45000; // 45秒 — 简历优化 API 调用 DeepSeek 需要较长时间

/**
 * 创建 Axios 实例
 *
 * 【baseURL 的环境差异 —— Docker 部署关键点】
 *
 * 开发环境（import.meta.env.PROD === false）：
 *   子应用跑在 :3001，后端跑在 :4000，属于跨域，
 *   所以 baseURL 写死 http://localhost:4000，配合后端 CORS 头工作。
 *
 * 生产环境（Docker 部署，PROD === true）：
 *   浏览器 → nginx:8080 → /api/* 反代到 server:4000，
 *   主应用、子应用、API 全部同源。此时如果用绝对地址 localhost:4000，
 *   请求会打到用户自己电脑上（必然失败），所以必须改成空字符串 = 相对路径。
 *   这样 /api/resume/optimize 会请求 当前域名/api/... → nginx 转发。
 */
const client: AxiosInstance = axios.create({
  baseURL: import.meta.env.PROD ? "" : "http://localhost:4000",
  timeout: REQUEST_TIMEOUT,
  headers: { "Content-Type": "application/json" },
});

// ========== 请求拦截器 ==========
client.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  if (import.meta.env.DEV) {
    console.log(
      `[resume-optimizer API] ${config.method?.toUpperCase()} ${config.url}`
    );
  }
  return config;
});

// ========== 响应拦截器 ==========
client.interceptors.response.use(
  (response) => response.data, // 解包 axios 包装
  (error: AxiosError<{ message?: string; code?: string }>) => {
    // 1) 用户主动取消（AbortController / 组件卸载 / 路由切换）
    //    不应作为错误冒泡，标记为静默错误
    if (axios.isCancel(error) || error.code === "ERR_CANCELED") {
      return Promise.reject({
        success: false,
        message: "请求已取消",
        code: "CANCELLED",
        silent: true,
      });
    }

    if (error.response) {
      const { status, data } = error.response;
      if (status === 401) {
        clearAuthToken();
      }
      return Promise.reject({
        success: false,
        message: data?.message || `请求失败 (${status})`,
        code: data?.code || `HTTP_${status}`,
      });
    }
    if (error.request) {
      return Promise.reject({
        success: false,
        message:
          error.code === "ECONNABORTED"
            ? "请求超时，请检查网络后重试"
            : "网络异常，请检查网络连接",
        code: error.code === "ECONNABORTED" ? "TIMEOUT" : "NETWORK_ERROR",
      });
    }
    return Promise.reject({
      success: false,
      message: error.message || "未知错误",
      code: "UNKNOWN",
    });
  }
);

export default client;
