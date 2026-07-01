/// <reference types="vite/client" />

/**
 * Vite 环境变量类型声明
 * 扩展 import.meta.env 的类型定义
 */
interface ImportMetaEnv {
  /** 主应用 API 地址，子应用通过此地址调用主应用的后端接口 */
  readonly VITE_MAIN_APP_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
