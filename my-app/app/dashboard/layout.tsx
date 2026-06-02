"use client";

import { MainLayout } from '@/components/layout/MainLayout';
import { ConfigProvider, App, theme as antdTheme } from 'antd';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

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
