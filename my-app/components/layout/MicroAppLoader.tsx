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
import { getToken, setToken, removeToken } from '@/api';
import { getConfigValue } from '@/lib/app-config';

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
  // 重试计数器：自增后触发 useEffect 重新执行（无需刷新整页）
  const [retryKey, setRetryKey] = useState(0);

  // 保存当前 MicroApp 实例引用（便于排查与清理）
  const microAppRef = useRef<MicroApp | null>(null);

  // 开发环境标识（用于给出针对性的失败提示文案）
  const isDev = process.env.NODE_ENV === 'development';

  // ---------- 加载子应用 ----------
  useEffect(() => {
    /**
     * 本次 effect 的「作废标志」。
     *
     * 【为什么用局部变量而不是组件级 ref？】
     * React 18 StrictMode 在开发模式下会走「mount → cleanup → mount」。
     * 若用共享 ref 标记「已卸载」，第二次 mount 会把它重置为 false，
     * 于是第一轮挂载遗留的异步流程会「误以为」自己仍然有效并继续加载 ——
     * 结果两次 loadMicroApp 并发抢同一个容器，qiankun 卡住、表现为加载超时。
     * 改用 effect 局部变量后，被 cleanup 作废的那一轮不会再往下执行。
     */
    let disposed = false;
    /** 是否已判定最终结果（成功/失败）：避免 Promise 回调与超时兜底重复置位 */
    let settled = false;

    setStatus('loading');
    setErrorMsg('');

    let app: MicroApp | null = null;

    /**
     * 加载超时上限（毫秒）。
     * 超过该时间仍未挂载成功 → 判定失败并给出提示，避免一直卡在 loading。
     */
    const LOAD_TIMEOUT_MS = 10000;

    /** 超时定时器句柄（先声明，供 fail 内部清理，避免 TDZ） */
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;

    /**
     * 统一失败处理（幂等：settled 保证只生效一次）。
     *
     * 【为什么要单独做这件事？】
     * qiankun 的资源加载是「异步」的：loadMicroApp 同步返回实例，
     * 真正的 fetch 失败只会让内部 Promise reject（且是未捕获的），
     * 不会进入外层的 try/catch —— 必须显式 catch 才能感知失败。
     * 之前的实现用「500ms 定时器无条件置为 loaded」来收尾，
     * 导致子应用未启动时遮罩被撤、容器为空 → 白屏。
     */
    const fail = (err?: unknown) => {
      if (settled) return;
      settled = true;
      if (timeoutTimer) clearTimeout(timeoutTimer);

      console.error('[MicroAppLoader] 子应用加载失败:', err);

      // 本次 effect 已作废（组件卸载 / StrictMode 重跑）→ 不再更新 UI
      if (disposed) return;

      const raw = err instanceof Error ? err.message : '';
      setStatus('error');
      setErrorMsg(
        raw ||
          (isDev
            ? '无法连接子应用服务（localhost:3001）'
            : '子应用资源加载失败')
      );
    };

    // 超时兜底：子应用既没成功也没报错（例如网络挂起）时，主动判定失败
    timeoutTimer = setTimeout(() => {
      fail(new Error(`加载超时（超过 ${LOAD_TIMEOUT_MS / 1000} 秒仍未就绪）`));
    }, LOAD_TIMEOUT_MS);

    /**
     * 预检：探测子应用服务是否真的存活。
     *
     * 【为什么必须探活？】
     * qiankun 会缓存已加载子应用的 HTML 与脚本（import-html-entry 的性能优化）。
     * 因此即使子应用服务已经关闭，重新进入页面时它仍可能用缓存「复活」出一个
     * 看似正常的界面 —— 让人误以为子应用还在运行。
     * 这里在交给 qiankun 之前先探活：服务不可用就直接提示，
     * 保证页面呈现的状态与子应用的真实状态一致。
     *
     * 探活请求带时间戳 + no-store，避免被 HTTP 缓存给出假阳性结果。
     */
    const probeEntry = async (): Promise<void> => {
      const entryUrl = MICRO_APP_CONFIG.entry.startsWith('//')
        ? `${window.location.protocol}${MICRO_APP_CONFIG.entry}`
        : MICRO_APP_CONFIG.entry;
      const probeUrl = `${entryUrl}${entryUrl.includes('?') ? '&' : '?'}__probe=${Date.now()}`;
      // 只探测「连接层是否可达」：拿到任何 HTTP 响应都算服务还活着
      //（状态码交给 qiankun 判定），只有网络层失败（连接被拒 / CORS 被拦 / DNS 失败）
      // 才会抛异常 —— 既能在子应用关闭时如实报错，又不会因状态码差异产生误报。
      await fetch(probeUrl, { method: 'GET', cache: 'no-store' });
    };

    /**
     * 真正的加载流程：先探活 → 再交给 qiankun 挂载。
     */
    const startLoad = async (): Promise<void> => {
      // ---------- 1. 探活：子应用不可用就直接提示，不进入 qiankun 缓存 ----------
      try {
        await probeEntry();
      } catch (probeError) {
        const raw = probeError instanceof Error ? probeError.message : '';
        fail(
          new Error(
            raw && raw !== 'Failed to fetch'
              ? raw
              : isDev
                ? '无法连接子应用服务（请确认子应用已启动）'
                : '子应用服务暂时不可用'
          )
        );
        return;
      }

      // 探活期间本次 effect 已作废 → 不再加载
      if (disposed) return;

      // ---------- 2. 交给 qiankun 完成加载与挂载 ----------
      try {
        /**
         * 手动加载子应用
         *
         * loadMicroApp 返回一个 MicroApp 实例，包含以下 Promise 与状态方法：
         * - loadPromise / bootstrapPromise / mountPromise: 各阶段完成的 Promise
         * - mount() / unmount() / update(props) / getStatus()
         *
         * qiankun 内部会：
         * 1. fetch 子应用的 entry HTML
         * 2. 解析并下载 JS/CSS 文件
         * 3. 创建沙箱环境
         * 4. 执行子应用的 bootstrap() 和 mount() 生命周期钩子
         */
        app = loadMicroApp(
          {
            name: MICRO_APP_CONFIG.name,
            entry: MICRO_APP_CONFIG.entry,
            container: MICRO_APP_CONFIG.container,
            // 传递给子应用的 props，子应用在 mount(props) 中接收
            props: {
              /**
               * Token 共享机制 — 子应用通过这三个函数与主应用共享登录状态：
               *
               * token: 当前 Token 值（用于子应用初始化时立即读取）
               * getToken: 子应用随时调用，获取最新 Token（用于 API 请求注入 Authorization 头）
               * setToken: 子应用登录成功后，通过此函数回写 Token 到主应用的 localStorage
               * removeToken: 子应用退出登录时，清除主应用的 Token
               * isInQiankun: 标记当前运行在 qiankun 环境中，子应用据此决定是否显示独立登录页
               */
              token: getToken(),
              getToken,
              setToken,
              removeToken,
              isInQiankun: true,

              /**
               * 配置共享机制 — 子应用据此读取主应用的配置中心。
               *
               * 传的是「函数」而不是「配置快照」：函数内部读的是主应用的
               * window.appConfig 单例，配置热更新（管理员在设置页改完）后
               * 子应用下次调用就能拿到新值，无需 app.update() 重新下发 props。
               *
               * 注意：必须包一层箭头函数。直接把 getConfigValue 传过去会因为
               * 跨沙箱调用丢失 this 绑定（该方法内部依赖 window.appConfig）。
               */
              getConfigValue: <T,>(key: string, defaultValue: T): T =>
                getConfigValue(key, defaultValue),

              // 其他业务标识
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

        // 加载期间本次 effect 已作废 → 立即清理，避免子应用「挂空」
        if (disposed) {
          try {
            app.unmount();
          } catch {
            // ignore
          }
          return;
        }

        // ★ 监听真实加载结果（成功 / 失败），取代原先的「500ms 无条件置成功」
        app.mountPromise
          .then(() => {
            if (settled) return;
            settled = true;
            if (timeoutTimer) clearTimeout(timeoutTimer);
            if (!disposed) {
              setStatus('loaded');
            }
          })
          .catch((err) => fail(err));

        // loadPromise 兜底：若在「下载入口 HTML / 资源」阶段就失败，
        // mountPromise 可能来不及 reject，这里再兜一层，确保失败必定被感知。
        app.loadPromise.catch((err) => fail(err));
      } catch (error) {
        // 同步异常（如容器不存在、配置非法）
        fail(error);
      }
    };

    void startLoad();

    return () => {
      disposed = true;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (app) {
        console.log('[MicroAppLoader] 卸载子应用:', MICRO_APP_CONFIG.name);
        // qiankun unmount 返回 promise，我们这里同步调用即可
        try {
          app.unmount();
        } catch (e) {
          // 加载失败时 unmount 可能抛错，忽略即可
          console.warn('[MicroAppLoader] 卸载子应用时出错:', e);
        }
        if (microAppRef.current === app) {
          microAppRef.current = null;
        }
      }
      // 兜底：清空容器残留 DOM（qiankun 卸载不彻底时避免留下「僵尸」界面）
      const container = document.getElementById('micro-app-container');
      if (container) container.innerHTML = '';
    };
  }, [retryKey]); // retryKey 变化时重新加载（重试按钮触发）

  /**
   * 重试加载：清空容器残留 DOM，并让 useEffect 重新执行。
   *
   * 不使用 window.location.reload()，避免整页刷新丢失当前上下文。
   */
  const handleRetry = () => {
    const container = document.getElementById('micro-app-container');
    if (container) container.innerHTML = '';
    setStatus('loading');
    setErrorMsg('');
    setRetryKey((k) => k + 1);
  };

  // ========== 渲染 ==========

  /**
   * 统一渲染结构：容器 + 状态覆盖层。
   *
   * 【为什么不把「失败态」单独 return 成不含容器的 DOM？】
   * 因为 #micro-app-container 必须始终存在于 DOM 中 ——
   * qiankun 挂载（以及点重试后的重新挂载）都要在 DOM 里找到这个容器。
   * 如果失败态把容器卸载掉，点「重新加载」会因找不到容器再次失败。
   * 因此这里固定渲染容器，用覆盖层承载「加载中 / 失败」两种状态。
   */
  return (
    <div style={{ position: 'relative', minHeight: '100vh' }}>
      {/* 加载中：覆盖层 */}
      {status === 'loading' && (
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          gap: '16px',
          background: 'var(--background)',
          zIndex: 1,
        }}>
          <Spin size="large" />
          <p style={{ color: 'var(--muted-foreground)', fontSize: '14px' }}>
            正在加载 AI 简历优化模块...
          </p>
        </div>
      )}

      {/* 加载失败：覆盖层（不白屏，给出可操作提示） */}
      {status === 'error' && (
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          padding: '48px 24px',
          background: 'var(--background)',
          zIndex: 1,
          overflow: 'auto',
        }}>
          <Alert
            type="error"
            showIcon
            message={
              isDev
                ? '子应用未启动，无法加载「简历优化」模块'
                : '无法加载「简历优化」模块'
            }
            description={
              <div>
                <p style={{ marginBottom: 12 }}>{errorMsg}</p>

                {isDev ? (
                  /* 开发环境：给出可直接执行的启动命令 */
                  <div style={{ marginBottom: 16 }}>
                    <p style={{ marginBottom: 8 }}>
                      请在<strong>另一个终端</strong>启动子应用后点击重试：
                    </p>
                    <pre style={{
                      margin: 0,
                      padding: '10px 12px',
                      background: 'var(--muted, rgba(0,0,0,0.04))',
                      borderRadius: 6,
                      fontSize: 12,
                      fontFamily: 'monospace',
                      whiteSpace: 'pre-wrap',
                    }}>
{`cd resume-optimizer
pnpm dev`}
                    </pre>
                    <p style={{ marginTop: 8, fontSize: 13, color: 'var(--muted-foreground)' }}>
                      子应用地址：http://localhost:3001
                    </p>
                  </div>
                ) : (
                  /* 生产环境：不暴露内部细节，给出通用指引 */
                  <p style={{ marginBottom: 16, color: 'var(--muted-foreground)', fontSize: 13 }}>
                    该模块的资源暂时无法获取，请稍后重试；若持续失败请联系管理员。
                  </p>
                )}

                <Button type="primary" icon={<ReloadOutlined />} onClick={handleRetry}>
                  重新加载
                </Button>
              </div>
            }
            style={{ maxWidth: 640, width: '100%' }}
          />
        </div>
      )}

      {/* 子应用挂载容器 - qiankun 将子应用的 React 应用渲染到此 div 内 */}
      <div
        id="micro-app-container"
        style={{
          minHeight: '100vh',
          // 加载完成后显示；加载中/失败时隐藏（状态由覆盖层承载）
          opacity: status === 'loaded' ? 1 : 0,
          transition: 'opacity 0.3s ease',
        }}
      />
    </div>
  );
};

export default MicroAppLoader;
