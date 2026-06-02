"use client";

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

  const handleMenuClick = ({ key }: { key: string }) => {
    switch (key) {
      case '1':
        router.push('/dashboard');
        break;
      case '2':
        router.push('/dashboard/jobs');
        break;
      case '3':
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

  const getSelectedKey = () => {
    if (pathname === '/dashboard/jobs') return ['2'];
    if (pathname === '/dashboard/resume') return ['3'];
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
            { key: '3', icon: <FileTextOutlined />, label: '简历优化' },
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

        <Content className="flex-1 overflow-auto p-0 relative">
          {children}
        </Content>
      </Layout>
    </Layout>
  );
}
