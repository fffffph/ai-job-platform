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

import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
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

/** 空订阅器：useSyncExternalStore 只用来回答「我在不在客户端」，无需真实订阅 */
const emptySubscribe = () => () => {};

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
  /**
   * 客户端挂载检测（SSR 水合专用，避免 effect 内 setState）。
   * 与 dashboard/layout.tsx 的 useMounted 同款：useSyncExternalStore
   * 服务端快照 false / 客户端快照 true，无需 setState。
   */
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
  const [collapsed, setCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // 侧边栏菜单树（默认降级菜单，加载成功后替换为后端菜单）
  const [menus, setMenus] = useState<MenuTreeNode[]>(DEFAULT_MENUS);
  // 用户手动展开/收起的目录 key（当前路由要求展开的目录由派生逻辑并入，不在此存）
  const [manualOpenKeys, setManualOpenKeys] = useState<string[]>([]);

  /**
   * 移动端状态初始化（必做）。
   *
   * 【为什么不能只靠 Sider 的 onBreakpoint】
   * antd Sider 的 onBreakpoint 回调只在「跨越」断点时触发；手机用户直接
   * 以窄视口打开页面（首屏加载、或整页刷新）时不会回调，collapsed 保持
   * 初始值 false —— 侧边栏会以展开态浮在内容上遮挡列表（移动端回归实测）。
   * 这里用 matchMedia 在挂载时做一次初始检测并主动收起，再监听后续变化。
   * 断点口径与 Sider breakpoint="lg" 一致：lg = 992px。
   */
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 991.98px)');
    const apply = () => {
      const mobile = mql.matches;
      setIsMobile(mobile);
      if (mobile) {
        setCollapsed(true); // 手机端默认收起，点汉堡按钮才展开（浮层+遮罩）
      }
    };
    apply();
    mql.addEventListener('change', apply);
    return () => mql.removeEventListener('change', apply);
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

  /**
   * 最终展开集合 = 用户手动展开 ∪ 当前路由要求展开。
   *
   * 【为什么用派生而不是 effect 合并】
   * 原实现在 effect 里 setOpenKeys 合并 routeOpenKeys —— effect 体内同步
   * setState 会触发 react-hooks/set-state-in-effect（级联渲染告警）。
   * 改为 useMemo 派生后零 effect：路由要求的目录始终展开、用户手动展开项
   * 也保留；唯一副作用在 onOpenChange 事件回调里（合法位置）。
   * 行为差异：当前路由所在的目录无法被手动收起（会保持展开），语义更稳。
   */
  const openKeys = useMemo(
    () => Array.from(new Set([...manualOpenKeys, ...routeOpenKeys])),
    [manualOpenKeys, routeOpenKeys]
  );

  /**
   * 传给 Menu 的展开集合（折叠态强制清空）。
   *
   * 【为什么折叠态必须传空数组】
   * Sider 折叠后 antd Menu 进入 inline-collapsed 模式，此时受控 openKeys
   * 里的目录会被渲染成「悬浮弹层」挂在侧栏旁边。若仍传入路由要求的
   * 展开项（如「系统设置」），弹层会在无人操作时直接盖在内容上 ——
   * 移动端回归实测到的「菜单浮层遮挡用户列表」就是这个机制。
   * 折叠态清空后，子菜单弹层只在用户主动点父节点时出现。
   */
  const menuOpenKeys = collapsed ? [] : openKeys;

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
          openKeys={menuOpenKeys}
          onOpenChange={(keys) => setManualOpenKeys(keys as string[])}
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
