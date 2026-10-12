"use client";

/**
 * MainLayout.tsx —— Dashboard 主布局组件（qiankun 微前端基座）
 *
 * 【架构说明】
 * CareerAI 采用 qiankun 微前端架构，将核心业务模块拆分为独立子应用。
 * 主应用负责侧边栏、顶栏与内容区的整体布局；「简历优化」入口对应
 * qiankun 子应用（resume-optimizer），通过 /dashboard/resume → MicroAppLoader 加载。
 *
 * 【本版本改造（RBAC 动态菜单）】
 * - 删除原硬编码的 items 数组（key 1–6）与 switch 跳转；
 * - 侧边栏改为消费「登录后拉取的菜单树」（window 单例 window.__APP_CONFIG__.menus），
 *   经 lib/menu-tree.buildMenuItems 映射为 Antd Menu items；
 * - 点击按 item 的 path 路由跳转；选中/展开按 pathname 前缀匹配；
 * - 接口失败/空菜单时降级渲染 5 个业务菜单并提示（不白屏）。
 *
 * 【数据流】
 * 登录 → loadAppConfig() 并发拉取 /api/user/roles、/api/menu/my、/api/config
 *      → 写入 window.__APP_CONFIG__ → MainLayout 消费 menus 渲染侧边栏。
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Layout, Menu, Button, App, Switch, Space } from 'antd';
import type { MenuProps } from 'antd';
import {
  ThunderboltOutlined,
  LogoutOutlined,
  SunOutlined,
  MoonOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
} from '@ant-design/icons';
import { useRouter, usePathname } from 'next/navigation';
import { useTheme } from 'next-themes';
import { loadAppConfig, clearAppConfig } from '@/lib/app-config';
import { buildMenuItems, resolveMenuState } from '@/lib/menu-tree';
import { removeToken } from '@/api';
import type { MenuTreeNode } from '@/api';

const { Header, Content, Sider } = Layout;

/**
 * 默认降级菜单（接口失败或返回空时使用）。
 *
 * 仅包含 5 个业务菜单，保证主流程可用；不含「系统设置」（避免普通用户误入）。
 */
const DEFAULT_MENUS: MenuTreeNode[] = [
  { id: 'dashboard', code: 'dashboard', name: '工作台', path: '/dashboard', icon: 'dashboard', sort: 10 },
  { id: 'jobs', code: 'jobs', name: '职位发现', path: '/dashboard/jobs', icon: 'project', sort: 20 },
  { id: 'resume', code: 'resume', name: '简历优化', path: '/dashboard/resume', icon: 'file-text', sort: 30 },
  { id: 'profile', code: 'profile', name: '个人中心', path: '/dashboard/profile', icon: 'user', sort: 40 },
  { id: 'history', code: 'history', name: '决策历史', path: '/dashboard/history', icon: 'history', sort: 50 },
];

export function MainLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const { message } = App.useApp();
  const [mounted, setMounted] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // 侧边栏菜单树（默认降级菜单，加载成功后替换为后端菜单）
  const [menus, setMenus] = useState<MenuTreeNode[]>(DEFAULT_MENUS);
  // 受控展开的目录 key 列表
  const [openKeys, setOpenKeys] = useState<string[]>([]);

  useEffect(() => {
    setMounted(true);
  }, []);

  // 登录后拉取菜单树（消费 window 单例；已有缓存直接命中）
  useEffect(() => {
    let cancelled = false;
    loadAppConfig()
      .then((state) => {
        if (cancelled) return;
        const list = state?.menus ?? [];
        if (list.length > 0) {
          setMenus(list);
        } else {
          // 空菜单 → 降级默认菜单并提示（不白屏）
          setMenus(DEFAULT_MENUS);
          message.warning('菜单加载失败，已展示默认菜单');
        }
      })
      .catch(() => {
        if (cancelled) return;
        setMenus(DEFAULT_MENUS);
        message.warning('菜单加载失败，已展示默认菜单');
      });
    return () => {
      cancelled = true;
    };
  }, [message]);

  // 后端菜单树 → Antd Menu items
  const items = useMemo(() => buildMenuItems(menus), [menus]);

  // 当前路由对应的选中项 + 应展开目录
  const { selectedKeys, openKeys: routeOpenKeys } = useMemo(
    () => resolveMenuState(pathname, menus),
    [pathname, menus]
  );

  // 路由变化时，保证当前路由的祖先目录处于展开态（不清空用户手动展开项）
  useEffect(() => {
    setOpenKeys((prev) => Array.from(new Set([...prev, ...routeOpenKeys])));
  }, [routeOpenKeys]);

  const handleLogout = () => {
    removeToken(); // 清除登录 token（关键：否则退出后点浏览器返回又回到登录态）
    clearAppConfig(); // 清空角色/权限/菜单/配置缓存，防止越权残留
    router.replace('/login'); // replace 替换历史记录，避免返回键又回到 dashboard
  };

  /**
   * 菜单点击处理。
   *
   * 叶子节点 key 为路由 path（以 "/" 开头）→ router.push 导航；
   * 目录节点 key 为 `cat:xxx` → 不导航（仅展开/收起）。
   * 「简历优化」path 为 /dashboard/resume，对应 qiankun 子应用入口。
   */
  const handleMenuClick: MenuProps['onClick'] = ({ key }) => {
    if (key.startsWith('/')) {
      router.push(key);
    }
    if (isMobile) {
      setCollapsed(true);
    }
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
          selectedKeys={selectedKeys}
          openKeys={openKeys}
          onOpenChange={(keys) => setOpenKeys(keys as string[])}
          onClick={handleMenuClick}
          className="bg-transparent border-none"
          items={items}
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
