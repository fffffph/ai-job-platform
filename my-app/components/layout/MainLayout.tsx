"use client";

/**
 * MainLayout.tsx —— Dashboard 主布局组件（qiankun 微前端基座）
 *
 * 【架构说明】
 * CareerAI 采用 qiankun 微前端架构，将核心业务模块拆分为独立子应用：
 *
 * ┌─────────────────────────────────────────────────────────┐
 * │                    主应用（Next.js 基座）                  │
 * │  ┌───────┐  ┌─────────┐  ┌──────────────────────────┐   │
 * │  │ 登录   │  │ 注册     │  │  MainLayout (此文件)       │   │
 * │  │ 路由   │  │ 路由     │  │  ├── 侧边栏 (Sider)        │   │
 * │  └───────┘  └─────────┘  │  ├── 顶栏 (Header)          │   │
 * │                           │  └── 内容区 (Content)       │   │
 * │                           │       ├── /dashboard        │   │
 * │                           │       │   → page.tsx（主应用）│  │
 * │                           │       ├── /dashboard/jobs   │   │
 * │                           │       │   → page.tsx（主应用）│  │
 * │                           │       ├── /dashboard/resume │   │
 * │                           │       │   → MicroAppLoader   │  │
 * │                           │       │   → [qiankun 子应用]│   │
 * │                           │       └── /dashboard/profile│   │
 * │                           │           → page.tsx（主应用）│  │
 * └───────────────────────────┴──────────────────────────────┘
 *                                     │
 *                                     │ loadMicroApp
 *                                     ▼
 * ┌─────────────────────────────────────────────────────────┐
 * │             resume-optimizer 子应用 (Vite + React)        │
 * │  ┌─────────────────────────────────────────────────────┐│
 * │  │  ResumeOptimizationPage                             ││
 * │  │  ├── 简历上传/文本输入                                ││
 * │  │  ├── 文件解析 (→ /api/parse-resume)                  ││
 * │  │  └── AI 优化 (→ /api/chat)                          ││
 * │  └─────────────────────────────────────────────────────┘│
 * └─────────────────────────────────────────────────────────┘
 *
 * 【路由与菜单映射】
 * key='1' → /dashboard          → 工作台（主应用）
 * key='2' → /dashboard/jobs     → 职位发现（主应用）
 * key='3' → /dashboard/resume   → 简历优化（qiankun 子应用 ★）
 * key='4' → /dashboard/profile  → 个人中心（主应用）
 *
 * 用户点击"简历优化"菜单时，router.push('/dashboard/resume')
 * 对应的 page.tsx 通过 dynamic import 加载 MicroAppLoader，
 * MicroAppLoader 使用 qiankun loadMicroApp 加载子应用。
 */

import React, { useEffect, useState } from 'react';
import { Layout, Menu, Button, theme as antdTheme, ConfigProvider, App, Switch, Space } from 'antd';
import { 
  UserOutlined, 
  ProjectOutlined, 
  FileTextOutlined, 
  ThunderboltOutlined,
  LogoutOutlined,
  DashboardOutlined,
  SunOutlined,
  MoonOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined
} from '@ant-design/icons';
import { useRouter, usePathname } from 'next/navigation';
import { useTheme } from 'next-themes';

const { Header, Content, Sider } = Layout;

export function MainLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleLogout = () => {
    router.push('/login');
  };

  /**
   * 菜单点击处理
   *
   * 【微前端路由说明】
   * key='3'（简历优化）路由到 /dashboard/resume，
   * 该页面的 page.tsx 通过 next/dynamic 加载 MicroAppLoader 组件。
   * MicroAppLoader 内部使用 qiankun 的 loadMicroApp 手动加载 resume-optimizer 子应用。
   *
   * 使用 loadMicroApp（而非 registerMicroApps + start）的原因：
   * 1. Next.js App Router 的客户端路由与 qiankun 的 URL 拦截式路由注册冲突
   * 2. 手动加载模式在组件级别控制挂载时机，与 React 生命周期天然契合
   * 3. 组件卸载时调用 app.unmount()，避免内存泄漏
   */
  const handleMenuClick = ({ key }: { key: string }) => {
    switch (key) {
      case '1':
        router.push('/dashboard');
        break;
      case '2':
        router.push('/dashboard/jobs');
        break;
      case '3':
        // ★ 微前端子应用入口：加载 resume-optimizer 子应用
        router.push('/dashboard/resume');
        break;
      case '4':
        router.push('/dashboard/profile');
        break;
    }
    if (isMobile) {
      setCollapsed(true);
    }
  };

  /**
   * 根据当前路径计算菜单选中项
   *
   * /dashboard/resume 对应 key='3'（简历优化 - 微前端子应用）
   */
  const getSelectedKey = () => {
    if (pathname === '/dashboard/jobs') return ['2'];
    if (pathname === '/dashboard/resume') return ['3']; // ★ 子应用路由
    if (pathname === '/dashboard/profile') return ['4'];
    return ['1'];
  };

  const isDark = theme === 'dark';

  return (
    <Layout className="h-screen overflow-hidden bg-background transition-colors duration-300">
      {isMobile && !collapsed && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 transition-opacity"
          onClick={() => setCollapsed(true)}
        />
      )}
      <Sider
        breakpoint="lg"
        collapsedWidth="0"
        collapsed={collapsed}
        onCollapse={(value) => setCollapsed(value)}
        onBreakpoint={(broken) => {
          setIsMobile(broken);
          setCollapsed(broken);
        }}
        trigger={null}
        className="border-r border-border bg-card/80 backdrop-blur-xl transition-all duration-300"
        theme={mounted && !isDark ? 'light' : 'dark'}
        style={isMobile ? { 
          position: 'fixed', 
          height: '100vh', 
          zIndex: 50
        } : {}}
      >
        <div className="p-6 flex items-center gap-3">
          <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center shadow-lg shadow-primary/20">
            <ThunderboltOutlined className="text-primary-foreground text-lg" />
          </div>
          <span className="text-foreground font-bold text-lg tracking-tight">CareerAI</span>
        </div>
        <Menu
          theme={mounted && !isDark ? 'light' : 'dark'}
          mode="inline"
          selectedKeys={getSelectedKey()}
          onClick={handleMenuClick}
          className="bg-transparent border-none"
          items={[
            { key: '1', icon: <DashboardOutlined />, label: '工作台' },
            { key: '2', icon: <ProjectOutlined />, label: '职位发现' },
            {
              key: '3',
              icon: <FileTextOutlined />,
              label: '简历优化',
              // ★ 此菜单项对应的路由加载 qiankun 子应用（resume-optimizer）
              // 子应用通过 MicroAppLoader → loadMicroApp 动态挂载
            },
            { key: '4', icon: <UserOutlined />, label: '个人中心' },
          ]}
        />
      </Sider>
      
      <Layout className="bg-transparent flex flex-col transition-all duration-300">
        <Header 
          className="!bg-card/80 backdrop-blur-md border-b border-border flex items-center justify-between z-10 transition-colors duration-300"
          style={{ paddingInline: isMobile ? '1rem' : '2rem' }}
        >
          <div className="flex items-center gap-4">
            {isMobile && (
              <Button
                type="text"
                icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                onClick={() => setCollapsed(!collapsed)}
                className="text-foreground text-lg"
              />
            )}
            <h2 className="text-foreground/80 font-medium m-0 text-sm sm:text-base truncate max-w-[100px] sm:max-w-none">欢迎回来，求职者</h2>
          </div>
          <Space size="middle">
            {mounted && (
              <Switch
                checked={isDark}
                onChange={(checked) => setTheme(checked ? 'dark' : 'light')}
                checkedChildren={<MoonOutlined />}
                unCheckedChildren={<SunOutlined />}
                className={isDark ? 'bg-blue-600' : 'bg-gray-300'}
              />
            )}
            <Button 
              type="text" 
              icon={<LogoutOutlined />} 
              onClick={handleLogout}
              className="text-muted-foreground hover:text-foreground"
            >
              退出登录
            </Button>
          </Space>
        </Header>

        {/*
          内容区域 —— 子应用的挂载宿主
          
          当路由为 /dashboard/resume 时，children 为 MicroAppLoader 组件。
          MicroAppLoader 在此区域创建 #micro-app-container 容器，
          qiankun 将子应用渲染到该容器内。
          
          其他路由的 children 为普通的 Next.js 页面组件。
        */}
        <Content className="flex-1 overflow-auto p-0 relative">
          {children}
        </Content>
      </Layout>
    </Layout>
  );
}
