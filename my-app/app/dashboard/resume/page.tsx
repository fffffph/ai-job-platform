/**
 * /dashboard/resume/page.tsx —— AI简历优化（微前端版本）
 *
 * 【架构变更说明】
 * 原 resume/page.tsx 现已拆分为独立的 qiankun 子应用（resume-optimizer 项目）。
 * 当前页面通过 MicroAppLoaderWrapper 组件加载子应用，保持原有 URL 路径不变。
 *
 * 用户访问 /dashboard/resume 时：
 * 1. Next.js 渲染当前页面（服务端：最小化 HTML 骨架）
 * 2. 客户端 hydration 后，MicroAppLoaderWrapper 挂载
 * 3. MicroAppLoaderWrapper 动态加载 MicroAppLoader（qiankun）
 * 4. MicroAppLoader 调用 qiankun loadMicroApp 加载子应用
 * 5. 子应用在 #micro-app-container 容器内渲染
 *
 * 【SSR 处理策略】
 * 本文件是 Server Component（无 'use client'），不能直接使用 `dynamic(..., { ssr: false })`。
 * 因此将 dynamic import 逻辑封装在 MicroAppLoaderWrapper 中（Client Component），
 * 通过本文件间接引用，实现服务端安全渲染。
 *
 * 【备用方案】
 * 原纯 Next.js 版本的页面保留在 page.bak.tsx 中，如需回退可直接恢复。
 */

import MicroAppLoaderWrapper from '@/components/layout/MicroAppLoaderWrapper';

/**
 * 页面组件（Server Component）
 *
 * 简单透传渲染客户端包裹器 MicroAppLoaderWrapper。
 * 所有的 qiankun 逻辑和 dynamic import 均在客户端侧执行。
 */
export default function ResumePage() {
  return <MicroAppLoaderWrapper />;
}
