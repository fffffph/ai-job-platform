import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import qiankun from 'vite-plugin-qiankun';
import path from 'path';

/**
 * Vite 构建配置文件 - AI简历优化子应用
 *
 * 【关键说明】
 * 本配置使子应用同时支持两种运行模式：
 * 1. 独立开发模式（npm run dev）—— 通过 vite-plugin-qiankun 兼容 qiankun 加载
 * 2. qiankun 微前端模式 —— 构建为 UMD 格式，导出生命周期钩子供主应用加载
 *
 * 【Vite 开发模式 + qiankun 兼容性核心问题】
 * Vite 开发服务器在 HTML 中注入的脚本使用 `type="module"`（ES Module 语法），
 * 但 qiankun 的 import-html-entry 库默认以普通 <script> 标签执行这些脚本，
 * 导致浏览器报错：`Cannot use import statement outside a module`。
 *
 * 【解决方案：vite-plugin-qiankun】
 * 此插件在开发模式下（useDevMode: true）自动包装子应用：
 * 1. 修改 HTML 中的 script 标签，移除 `type="module"`，转为 qiankun 兼容格式
 * 2. 包装子应用入口，导出 qiankun 生命周期（bootstrap / mount / unmount）
 * 3. 处理 Vite 热更新客户端（@vite/client）的兼容性
 *
 * 【注意】
 * useDevMode: true 时，Vite 的热更新（HMR）功能不可用，
 * 因为热更新客户端与 qiankun 的脚本加载机制冲突。
 * 这是 qiankun + Vite 的已知限制，目前社区标准做法。
 *
 * @see https://qiankun.umijs.org/zh/guide/tutorial
 * @see https://github.com/umijs/vite-plugin-qiankun
 */
export default defineConfig(({ mode }) => {
  // 判断当前是否为生产构建
  const isProduction = mode === 'production';

  return {
    // ========== 基础配置 ==========
    // base 配置：开发模式下指定完整 URL，确保 qiankun 能正确拼接资源路径
    // 生产模式下，根据实际部署路径调整
    base: isProduction ? '/resume-optimizer/' : 'http://localhost:3001/',

    // ========== 开发服务器配置 ==========
    server: {
      // 子应用运行在独立端口，避免与主应用（Next.js 默认 3000）冲突
      port: 3001,
      strictPort: true,
      // 【vite-plugin-qiankun 要求】origin 必须明确指定
      // 确保 qiankun 拼接的绝对 URL 正确（如 http://localhost:3001/src/main.tsx）
      origin: 'http://localhost:3001',
      // 必须配置 CORS 跨域头，因为主应用（localhost:3000）会通过 fetch 请求子应用的资源
      // qiankun 使用 fetch 获取子应用的 HTML/JS/CSS 等静态资源
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
      // 配置代理，将子应用中对主应用的 API 请求转发到主应用
      proxy: {
        '/api': {
          target: 'http://localhost:3000', // 主应用 Next.js 开发服务器
          changeOrigin: true,
        },
      },
    },

    // ========== 路径解析 ==========
    resolve: {
      alias: {
        // @ 别名指向 src 目录，与主应用保持一致
        '@': path.resolve(__dirname, 'src'),
      },
    },

    // ========== 插件配置 ==========
    plugins: [
      /**
       * React 插件
       *
       * useDevMode: true 时，Vite 热更新（HMR）不可用，
       * 但 react() 插件仍然需要提供 JSX 转换功能。
       * 热更新功能由 vite-plugin-qiankun 接管，子应用重新挂载时自动刷新。
       */
      // react(),
      // 修复 @vitejs/plugin-react can't detect preamble 错误
      ...(isProduction ? [react()] : []),

      /**
       * vite-plugin-qiankun —— Vite 与 qiankun 微前端兼容插件
       *
       * 【作用】
       * 1. 开发模式下：修改 HTML 和脚本，使 ES Module 脚本能被 qiankun 正确加载
       *    解决 `Cannot use import statement outside a module` 错误
       * 2. 构建模式下：自动处理 qiankun 生命周期注入
       *
       * 【参数】
       * - 'resume-optimizer': 子应用名称（必须与 qiankun 注册时的 name 一致）
       * - useDevMode: true: 在开发模式下启用 qiankun 兼容包装（关闭 HMR）
       *
       * 【注意】
       * 此插件只在开发模式下启用 useDevMode。构建模式下（UMD），
       * 生命周期由 main.tsx 中的 export 语句手动提供。
       */
      qiankun('resume-optimizer', {
        useDevMode: true,
      }),
    ],

    // ========== 构建配置（UMD 输出）==========
    build: {
      // 输出目录
      outDir: 'dist',

      // 【核心】使用库模式构建
      lib: {
        // 入口文件：main.tsx 中导出了 qiankun 生命周期钩子
        entry: path.resolve(__dirname, 'src/main.tsx'),
        // UMD 模块的全局变量名，主应用通过 window['resume-optimizer'] 访问
        name: 'resume-optimizer',
        // 输出格式：UMD（Universal Module Definition）
        formats: ['umd'],
        // 输出文件名固定为 index.js
        fileName: () => 'index.js',
      },

      // Rollup 额外配置
      rollupOptions: {
        // 外部依赖：React 和 ReactDOM 由主应用提供，避免重复打包
        // 这样可以减小子应用体积，并确保 React 实例唯一
        external: ['react', 'react-dom'],
        output: {
          // 为外部依赖指定全局变量名
          globals: {
            react: 'React',
            'react-dom': 'ReactDOM',
          },
        },
      },

      // 禁用代码分割，确保所有代码打包为单个文件
      // qiankun 加载子应用时只需要一个入口 JS 文件
      cssCodeSplit: false,

      // 生成 sourcemap 便于调试
      sourcemap: true,

      // 目标浏览器
      target: 'es2017',
    },
  };
});
