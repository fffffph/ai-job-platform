/**
 * ============================================
 * 环境自适应 Token 工具
 * ============================================
 *
 * 【核心设计——双模式 Token 管理】
 *
 * 子应用可能运行在两种完全不同的环境中，本文件抽象出统一的
 * getToken / setToken / removeToken 接口，内部自动切换数据源：
 *
 *   qiankun 模式（嵌入主应用）：
 *     Token 由主应用管理（localStorage），通过 props 传入
 *     → getToken() 回调主应用的 getToken 函数
 *
 *   独立模式（npm run dev 直接访问 :3001）：
 *     Token 由子应用自己管理（独立的 localStorage key）
 *     → getToken() 读取子应用自己的 localStorage
 *
 * 【初始化流程】
 * main.tsx 的 mount() 中调用 initAuth() 注入主应用的 token 管理函数。
 * 独立模式下不调用 initAuth()，自动走 localStorage 兜底。
 */

// ============================================================
// 内部状态
// ============================================================

/** 是否运行在 qiankun 环境中 */
let _isQiankun = false;

/** 主应用注入的 token 获取函数（qiankun 模式使用） */
let _getTokenFromMain: (() => string | null) | null = null;

/** 主应用注入的 token 存储函数（qiankun 模式使用） */
let _setTokenFromMain: ((token: string) => void) | null = null;

/** 主应用注入的 token 清除函数（qiankun 模式使用） */
let _removeTokenFromMain: (() => void) | null = null;

/** 子应用独立模式下的 localStorage key */
const STANDALONE_TOKEN_KEY = "resume_optimizer_token";

// ============================================================
// 初始化函数（由 main.tsx 的 mount() 调用）
// ============================================================

/**
 * 初始化 Auth 工具
 *
 * 在 qiankun 模式（mount props 中 isInQiankun === true）时调用，
 * 传入主应用的 token 管理回调函数。
 * 独立模式下不调用此函数，自动走 localStorage 兜底。
 */
export function initAuth(config: {
  /** 是否在 qiankun 环境中 */
  isQiankun: boolean;
  /** qiankun 模式下的 token 获取回调 */
  getToken?: () => string | null;
  /** qiankun 模式下的 token 存储回调 */
  setToken?: (token: string) => void;
  /** qiankun 模式下的 token 清除回调 */
  removeToken?: () => void;
}): void {
  _isQiankun = config.isQiankun;

  if (config.isQiankun) {
    _getTokenFromMain = config.getToken || null;
    _setTokenFromMain = config.setToken || null;
    _removeTokenFromMain = config.removeToken || null;
  }
}

// ============================================================
// 统一接口（环境自适应）
// ============================================================

/**
 * 获取当前 Token
 *
 * qiankun 模式 → 调用主应用注入的 getToken 回调
 * 独立模式   → 从 localStorage 读取
 */
export function getToken(): string | null {
  if (_isQiankun && _getTokenFromMain) {
    return _getTokenFromMain();
  }
  // 独立模式：从自己的 localStorage 读取
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(STANDALONE_TOKEN_KEY);
  } catch {
    return null;
  }
}

/**
 * 存储 Token
 *
 * qiankun 模式 → 调用主应用注入的 setToken 回调（写主应用的 localStorage）
 * 独立模式   → 直接写子应用的 localStorage
 */
export function setToken(token: string): void {
  if (_isQiankun && _setTokenFromMain) {
    _setTokenFromMain(token);
    return;
  }
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STANDALONE_TOKEN_KEY, token);
  } catch {
    // localStorage 不可用（无痕模式等），静默失败
  }
}

/**
 * 清除 Token
 *
 * qiankun 模式 → 调用主应用注入的 removeToken 回调
 * 独立模式   → 清除子应用的 localStorage
 */
export function removeToken(): void {
  if (_isQiankun && _removeTokenFromMain) {
    _removeTokenFromMain();
    return;
  }
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(STANDALONE_TOKEN_KEY);
  } catch {
    // 静默失败
  }
}

/**
 * 是否在 qiankun 环境中
 *
 * 组件可通过此函数判断当前模式，从而决定是否需要渲染登录页/
 * 是否从主应用接收用户信息等。
 */
export function isInQiankun(): boolean {
  return _isQiankun;
}
