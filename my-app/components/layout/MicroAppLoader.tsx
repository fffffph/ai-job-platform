'use client';

/**
 * MicroAppLoader.tsx —— qiankun 子应用加载器
 *
 * 【核心职责】
 * 使用 qiankun 的 loadMicroApp API 手动加载子应用，管理子应用的完整生命周期。
 *
 * 【为什么用 loadMicroApp 而不是 registerMicroApps + start？】
 * Next.js App Router 使用客户端路由（<Link> / router.push），
 * 与 qiankun 的 URL 拦截式路由注册会冲突。
 * loadMicroApp 是手动加载模式，在组件内部控制挂载时机，与 Next.js 路由互不干扰。
 *
 * 【生命周期映射】
 * - 组件挂载   → loadMicroApp() → qiankun 调用子应用的 bootstrap + mount
 * - 组件卸载   → app.unmount()  → qiankun 调用子应用的 unmount
 * - 组件更新   → app.update()   → 更新 props（如全局状态变更时）
 *
 * 【加载状态】
 * - loading: 正在下载子应用的 JS/CSS 资源
 * - loaded: 子应用已成功挂载
 * - error: 子应用加载失败（网络、CORS、脚本错误等）
 *
 * @see https://qiankun.umijs.org/zh/api#loadmicroappapp-configuration
 */

import React, { useEffect, useRef, useState } from 'react';
import { loadMicroApp, type MicroApp } from 'qiankun';
import { Spin, Alert, Button } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';

// ========== 子应用配置 ==========

/**
 * 子应用注册配置
 *
 * name:  子应用唯一标识，必须与子应用构建配置中的 name（webpack output.library.name）一致
 * entry: 子应用入口地址，qiankun 会从这里 fetch HTML 并提取 JS/CSS 资源
 *        开发环境使用 localhost:3001，生产环境需替换为实际部署地址
 * container: 子应用挂载的 DOM 容器选择器
 */
const MICRO_APP_CONFIG = {
  name: 'resume-optimizer',                   // 必须与子应用 vite.config.ts 中 lib.name 一致
  entry: process.env.NODE_ENV === 'development'
    ? '//localhost:3001'                       // 开发环境：子应用 Vite 开发服务器
    : '/resume-optimizer/',                   // 生产环境：子应用静态资源路径
  container: '#micro-app-container',          // 子应用挂载的目标容器
};

// ========== 加载状态枚举 ==========
type LoadStatus = 'loading' | 'loaded' | 'error';

/**
 * MicroAppLoader 组件
 *
 * 使用方式：
 * ```tsx
 * // 在 page.tsx 中直接使用
 * export default function ResumeMicroPage() {
 *   return <MicroAppLoader />;
 * }
 * ```
 *
 * 当用户在 MainLayout 中点击"简历优化"菜单时，路由切换到当前页面，
 * 此组件挂载，触发 loadMicroApp 加载子应用。
 * 当用户切换到其他页面时，此组件卸载，cleanup 中调用 unmount。
 */
const MicroAppLoader: React.FC = () => {
  // ---------- 状态 ----------
  const [status, setStatus] = useState<LoadStatus>('loading');   // 加载状态
  const [errorMsg, setErrorMsg] = useState<string>('');          // 错误信息

  // 保存 MicroApp 实例引用，用于组件卸载时调用 unmount
  const microAppRef = useRef<MicroApp | null>(null);
  // 标记组件是否已卸载（防止卸载后仍执行 setState）
  const isUnmountedRef = useRef(false);

  // ---------- 加载子应用 ----------
  useEffect(() => {
    isUnmountedRef.current = false;
    let app: MicroApp | null = null;

    /**
     * 手动加载子应用
     *
     * loadMicroApp 返回一个 MicroApp 实例，包含以下方法：
     * - mount(): 手动触发挂载
     * - unmount(): 手动触发卸载
     * - update(props): 更新传给子应用的 props
     * - getStatus(): 获取当前状态
     *
     * qiankun 内部会：
     * 1. fetch 子应用的 entry HTML
     * 2. 解析并下载 JS/CSS 文件
     * 3. 创建沙箱环境
     * 4. 执行子应用的 bootstrap() 和 mount() 生命周期钩子
     */
    try {
      app = loadMicroApp(
        {
          name: MICRO_APP_CONFIG.name,
          entry: MICRO_APP_CONFIG.entry,
          container: MICRO_APP_CONFIG.container,
          // 传递给子应用的 props，子应用在 mount(props) 中接收
          props: {
            // 可以传递全局状态、用户信息、主题配置等
            // 子应用通过 mount(props) 钩子获取这些数据
            appName: 'CareerAI',
            pageTitle: 'AI 简历优化',
          },
        },
        {
          // sandbox 配置：使用实验性的样式隔离方案
          sandbox: {
            // strictStyleIsolation: 使用 Shadow DOM 严格隔离样式
            // 注意：Shadow DOM 会影响 Ant Design 的弹出层（Modal/Drawer/Dropdown），
            // 因为这些组件默认挂载到 document.body，不在 Shadow DOM 内。
            // 当前使用 experimentalStyleIsolation（给子应用样式加前缀）作为折中方案。
            strictStyleIsolation: false,
            experimentalStyleIsolation: true,
          },
        }
      );

      microAppRef.current = app;

      // 监听加载成功
      // qiankun 没有直接的 onSuccess 回调，但可以通过 Promise 和生命周期判断
      // 这里简单设置 500ms 延迟后判断是否仍为 loading 状态
      const loadTimer = setTimeout(() => {
        if (!isUnmountedRef.current) {
          setStatus('loaded');
        }
      }, 500);

      // 也可以监听子应用的 unmount 事件（用于调试）
      app.getStatus();

      return () => {
        clearTimeout(loadTimer);
        isUnmountedRef.current = true;
        if (app) {
          console.log('[MicroAppLoader] 卸载子应用:', MICRO_APP_CONFIG.name);
          // qiankun unmount 返回 promise，我们这里同步调用即可
          app.unmount();
          if (microAppRef.current === app) {
            microAppRef.current = null;
          }
        }
      };
    } catch (error: any) {
      console.error('[MicroAppLoader] 子应用加载失败:', error);
      if (!isUnmountedRef.current) {
        setStatus('error');
        setErrorMsg(error.message || '子应用加载失败，请检查子应用服务是否启动');
      }
      return () => {
        isUnmountedRef.current = true;
      };
    }
  }, []); // 仅在组件首次挂载时执行

  // ========== 渲染 ==========

  /**
   * 错误状态：显示错误信息和重试按钮
   */
  if (status === 'error') {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '400px',
        padding: '48px',
      }}>
        <Alert
          type="error"
          showIcon
          message="子应用加载失败"
          description={
            <div>
              <p style={{ marginBottom: '12px' }}>
                {errorMsg || '无法加载 AI 简历优化模块，请检查网络连接'}
              </p>
              <p style={{ color: '#999', fontSize: '13px', marginBottom: '12px' }}>
                提示：开发环境下请确保子应用已启动（npm run dev --prefix resume-optimizer）
              </p>
              <Button
                type="primary"
                icon={<ReloadOutlined />}
                onClick={() => {
                  // 重试：重置状态并重新加载
                  setStatus('loading');
                  setErrorMsg('');
                  isUnmountedRef.current = false;
                  // 强制重新渲染触发 useEffect
                  window.location.reload();
                }}
              >
                重新加载
              </Button>
            </div>
          }
          style={{ maxWidth: '600px' }}
        />
      </div>
    );
  }

  /**
   * 正常渲染：子应用容器 + 加载指示器
   *
   * #micro-app-container 是子应用的挂载点
   * qiankun 会在此容器内创建子应用的 DOM 树
   *
   * 【重要】容器元素必须在组件首次渲染时就存在于 DOM 中，
   * 因为 loadMicroApp 在 useEffect 中同步查找该容器。
   * 如果没有找到容器，子应用会挂载失败。
   */
  return (
    <div style={{ position: 'relative', minHeight: '100vh' }}>
      {/* 加载指示器：在子应用资源下载期间显示 */}
      {status === 'loading' && (
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          gap: '16px',
          background: 'var(--background, #f5f5f5)',
          zIndex: 1,
        }}>
          <Spin size="large" />
          <p style={{ color: 'var(--muted-foreground, #999)', fontSize: '14px' }}>
            正在加载 AI 简历优化模块...
          </p>
        </div>
      )}

      {/* 子应用挂载容器 - qiankun 将子应用的 React 应用渲染到此 div 内 */}
      <div
        id="micro-app-container"
        style={{
          minHeight: '100vh',
          // 加载完成后显示，加载中隐藏（由加载指示器覆盖）
          opacity: status === 'loaded' ? 1 : 0,
          transition: 'opacity 0.3s ease',
        }}
      />
    </div>
  );
};

export default MicroAppLoader;
