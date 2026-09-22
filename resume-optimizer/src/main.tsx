/**
 * main.tsx —— AI简历优化子应用入口文件
 *
 * 【核心职责】
 * 1. 导出 qiankun 生命周期钩子（bootstrap / mount / unmount），供主应用调用
 * 2. 在独立开发模式下（非 qiankun 环境），直接渲染 React 应用到 #root
 * 3. 设置 __webpack_public_path__ 动态公共路径，确保 qiankun 正确加载 JS/CSS 资源
 * 4. 初始化子应用的 Auth 工具（从主应用接收 token 管理函数，或走独立模式）
 *
 * 【Token 共享机制】
 * qiankun 模式：主应用通过 mount(props) 传入 token + setToken + removeToken 回调，
 *            子应用调用 initAuth() 注册，后续所有组件通过 useAuth() 获取 token。
 * 独立模式：不调用 initAuth()，auth 工具自动走 localStorage 兜底，
 *          AuthGuard 显示独立登录页。
 *
 * @see https://qiankun.umijs.org/zh/guide/tutorial
 * @see https://github.com/umijs/vite-plugin-qiankun
 */

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./public-path";
import { initAuth } from "./utils/auth";
import { renderWithQiankun, qiankunWindow } from "vite-plugin-qiankun/dist/helper";

/**
 * 定义 qiankun 传入的 props 类型
 *
 * 主应用在 MicroAppLoader.tsx 中通过 loadMicroApp({ props: {...} }) 传递以下字段：
 * - container: 主应用提供的 DOM 容器节点
 * - token: 当前 JWT Token 字符串
 * - getToken: 获取最新 Token 的回调函数
 * - setToken: 存储/更新 Token 的回调函数
 * - removeToken: 清除 Token 的回调函数
 * - isInQiankun: 标识符，标记当前运行在 qiankun 环境
 */
interface QiankunProps {
  container?: HTMLElement;
  token?: string;
  getToken?: () => string | null;
  setToken?: (token: string) => void;
  removeToken?: () => void;
  isInQiankun?: boolean;
  [key: string]: any;
}

// ========== 全局变量：保存 React root 实例 ==========
let root: ReactDOM.Root | null = null;

/**
 * 渲染 React 应用到指定容器
 *
 * qiankun 模式：从 props 提取 token/认证回调 → 初始化 Auth 工具 → 渲染 App
 * 独立模式：props 为空 → Auth 工具走 localStorage → 渲染 App（AuthGuard 拦截）
 *
 * @param props - qiankun 传入的 props，或空对象（独立模式）
 */
function render(props: QiankunProps = {}) {
  // ---------- 初始化认证工具 ----------
  // 从 qiankun props 中提取认证相关字段，注入 auth 工具
  if (props.isInQiankun) {
    initAuth({
      isQiankun: true,
      getToken: props.getToken,
      setToken: props.setToken,
      removeToken: props.removeToken,
    });
    console.log("[resume-optimizer] Auth 工具已初始化（qiankun 模式），token:", props.token ? "已获取" : "无");
  } else {
    console.log("[resume-optimizer] 独立模式启动，将使用独立登录");
  }

  // ---------- 获取挂载容器 ----------
  const { container } = props;
  const domNode = container
    ? container.querySelector("#root")
    : document.getElementById("root");

  if (!domNode) {
    console.error("[resume-optimizer] 未找到挂载容器节点");
    return;
  }

  // ---------- 创建 React root 并渲染 ----------
  // AuthProvider 内部会从 auth 工具读取 token，不需要显式传入
  root = ReactDOM.createRoot(domNode);
  root.render(<App />);
}

/**
 * 卸载 React 应用
 */
function cleanup() {
  if (root) {
    const currentRoot = root;
    root = null;
    /**
     * 使用 requestAnimationFrame 确保 unmount 在浏览器渲染帧之间执行，
     * 完全脱离 React 的渲染循环（render/commit phase）。
     *
     * React 19 中，setTimeout(0) 仍可能与 useInsertionEffect 冲突，
     * 而 rAF 保证在下一帧绘制前执行，已被 React 团队推荐为此类场景的解法。
     */
    requestAnimationFrame(() => {
      try {
        currentRoot.unmount();
      } catch (e) {
        console.error("[resume-optimizer] unmount error:", e);
      }
    });
  }
}

// ========== qiankun 生命周期注册 ==========
renderWithQiankun({
  mount(props: QiankunProps) {
    console.log("[resume-optimizer] mount —— 子应用挂载中...");
    render(props);
  },
  bootstrap() {
    console.log("[resume-optimizer] bootstrap —— 子应用初始化完成");
  },
  unmount() {
    console.log("[resume-optimizer] unmount —— 子应用卸载中...");
    cleanup();
  },
  update(props: QiankunProps) {
    console.log("[resume-optimizer] update —— 子应用更新 props", props);
  },
} as any);

// 独立运行模式：直接渲染
if (!qiankunWindow.__POWERED_BY_QIANKUN__) {
  render();
}

// ========== 生产环境 UMD 构建的兼容导出 ==========
export async function bootstrap() {
  console.log("[resume-optimizer] export bootstrap");
}
export async function mount(props: QiankunProps = {}) {
  console.log("[resume-optimizer] export mount");
  render(props);
}
export async function unmount(props: QiankunProps = {}) {
  console.log("[resume-optimizer] export unmount");
  cleanup();
}
