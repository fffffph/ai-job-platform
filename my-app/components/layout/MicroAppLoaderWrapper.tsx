'use client';

/**
 * MicroAppLoaderWrapper.tsx —— 客户端包裹器
 *
 * 【为什么需要这个文件？】
 * Next.js App Router 中，`next/dynamic` 的 `ssr: false` 选项只能在
 * Client Component（'use client'）中使用，不能直接在 Server Component
 * 中使用。本文件作为桥接层，将 qiankun 的加载逻辑隔离到纯客户端执行。
 *
 * 调用链：
 * page.tsx (Server Component)
 *   → MicroAppLoaderWrapper (Client Component)
 *     → MicroAppLoader (qiankun loadMicroApp)
 */

import dynamic from 'next/dynamic';

/**
 * 动态导入 MicroAppLoader，禁止 SSR
 *
 * - ssr: false  → qiankun 依赖浏览器 API（document、window、fetch），
 *                 无法在 Node.js 服务端执行，必须禁用服务端渲染
 * - loading     → SSR 阶段或客户端加载过程中的占位 UI
 */
const MicroAppLoader = dynamic(
  () => import('@/components/layout/MicroAppLoader'),
  {
    ssr: false,
    loading: () => (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        background: 'var(--background, #f5f5f5)',
        fontSize: '14px',
        color: 'var(--muted-foreground, #999)',
      }}>
        正在准备 AI 简历优化模块...
      </div>
    ),
  }
);

/**
 * 客户端包裹器组件
 *
 * 直接透传渲染 MicroAppLoader（经过 dynamic 包装）。
 * 此组件可在 Server Component 中直接引用，
 * 因为它是 Client Component，可以安全使用 ssr: false。
 */
export default function MicroAppLoaderWrapper() {
  return <MicroAppLoader />;
}
