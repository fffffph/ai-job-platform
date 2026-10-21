"use client";

import { MainLayout } from '@/components/layout/MainLayout';
import { ConfigProvider, App, theme as antdTheme } from 'antd';
import { useTheme } from 'next-themes';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { getToken } from '@/api';
import { loadAppConfig } from '@/lib/app-config';

/** 空订阅器：useSyncExternalStore 只要它回答「我在不在客户端」，无需真实订阅 */
const emptySubscribe = () => () => {};

/**
 * 客户端挂载检测（SSR 水合专用）。
 *
 * 【为什么不用 setMounted(true) 的 effect】
 * React Compiler 的 react-hooks/set-state-in-effect 禁止 effect 内同步
 * setState（会引发级联渲染）。useSyncExternalStore 三参形态是官方推荐的
 * 「mounted」替代：服务端快照返回 false、客户端快照返回 true，
 * 水合完成后自动切换，无需 setState。
 */
const useMounted = () =>
  useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();
  const router = useRouter();
  const mounted = useMounted();
  // 是否已通过登录校验（客户端路由守卫用，未认证前不渲染内容）
  const [authed, setAuthed] = useState(false);

  // ---------- 客户端路由守卫 ----------
  // 所有 /dashboard/* 页面都受此守卫保护：无 token 一律跳登录页。
  // 同时监听 pageshow 处理 bfcache（后退缓存）恢复：
  // 退出登录后点浏览器返回，页面从缓存恢复时重新校验 token，防止"假登录态"。
  useEffect(() => {
    const checkAuth = () => {
      if (getToken()) {
        setAuthed(true);
        // 兜底加载「菜单/权限/角色」到 window 单例：
        // 供 system 子目录的 403 守卫与 MainLayout 菜单渲染使用。
        // 已有缓存时 loadAppConfig 直接返回，不重复请求。
        loadAppConfig().catch(() => {
          /* 加载失败静默降级，不阻塞页面 */
        });
      } else {
        router.replace('/login');
      }
    };
    checkAuth();

    const onPageShow = (e: PageTransitionEvent) => {
      // persisted=true 表示页面是从 bfcache 恢复的（而非重新加载）
      if (e.persisted) {
        checkAuth();
      }
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, [router]);

  // 未认证时不渲染任何内容（避免未登录用户看到 dashboard 内容闪烁）
  if (!authed) return null;

  const isDark = theme === 'dark';

  return (
    <ConfigProvider
      theme={{
        algorithm: mounted && !isDark ? antdTheme.defaultAlgorithm : antdTheme.darkAlgorithm,
        token: {
          colorPrimary: '#3b82f6',
          borderRadius: 12,
          colorBgContainer: mounted && !isDark ? '#ffffff' : 'rgba(0, 0, 0, 0.4)',
        },
      }}
    >
      <App>
        <MainLayout>
          {children}
        </MainLayout>
      </App>
    </ConfigProvider>
  );
}
