"use client";

import { MainLayout } from '@/components/layout/MainLayout';
import { ConfigProvider, App, theme as antdTheme } from 'antd';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getToken } from '@/api';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  // 是否已通过登录校验（客户端路由守卫用，未认证前不渲染内容）
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // ---------- 客户端路由守卫 ----------
  // 所有 /dashboard/* 页面都受此守卫保护：无 token 一律跳登录页。
  // 同时监听 pageshow 处理 bfcache（后退缓存）恢复：
  // 退出登录后点浏览器返回，页面从缓存恢复时重新校验 token，防止"假登录态"。
  useEffect(() => {
    const checkAuth = () => {
      if (getToken()) {
        setAuthed(true);
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
