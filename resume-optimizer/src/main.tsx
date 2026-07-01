/**
 * main.tsx —— AI简历优化子应用入口文件
 *
 * 【核心职责】
 * 1. 导出 qiankun 生命周期钩子（bootstrap / mount / unmount），供主应用调用
 * 2. 在独立开发模式下（非 qiankun 环境），直接渲染 React 应用到 #root
 * 3. 设置 __webpack_public_path__ 动态公共路径，确保 qiankun 正确加载 JS/CSS 资源
 *
 * 【双模式支持】
 * 本入口文件同时支持两种运行模式：
 * 1. 开发模式（vite-plugin-qiankun）：使用 renderWithQiankun 包装，解决 ES Module 兼容性问题
 * 2. 构建模式（UMD）：手动导出 bootstrap / mount / unmount，供 qiankun 通过全局变量加载
 *
 * 【条件编译说明】
 * import.meta.env.DEV 是 Vite 的编译时常量，在构建模式下会被替换为 false，
 * 开发模式下的代码块（renderWithQiankun 动态导入）会被 Tree Shaking 移除，
 * 构建产物中只保留 UMD 导出的生命周期函数。
 *
 * 【执行流程】
 * - 独立运行：window.__POWERED_BY_QIANKUN__ 为 undefined → 直接 ReactDOM.render
 * - qiankun 加载：主应用先调用 bootstrap → mount(props) → 容器挂载 React 应用
 *               路由切换时调用 unmount → 卸载 React 应用
 *
 * @see https://qiankun.umijs.org/zh/guide/tutorial
 * @see https://github.com/umijs/vite-plugin-qiankun
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './public-path';
import { renderWithQiankun, qiankunWindow } from 'vite-plugin-qiankun/dist/helper';

/**
 * 定义 qiankun 传入的 props 类型
 * container: 主应用提供的 DOM 容器节点，子应用挂载到此节点内
 * onGlobalStateChange: 全局状态变更回调
 * setGlobalState: 设置全局状态
 */
interface QiankunProps {
  container?: HTMLElement;
  onGlobalStateChange?: (callback: (state: any, prevState: any) => void) => void;
  setGlobalState?: (state: any) => void;
  [key: string]: any;
}

// ========== 全局变量：保存 React root 实例 ==========
// 用于在 unmount 时调用 root.unmount() 清理
let root: ReactDOM.Root | null = null;

/**
 * 渲染 React 应用到指定容器
 *
 * 【挂载逻辑】
 * 1. 从 props.container 中查找 #root（qiankun 模式下，container 是主应用创建的 div）
 * 2. 如果找不到，回退到 document.getElementById('root')（独立开发模式）
 * 3. 创建 React root 并渲染 App 组件
 *
 * @param props - qiankun 传入的 props，其中 container 是挂载点
 */
function render(props: QiankunProps = {}) {
  // 获取挂载容器：优先使用 qiankun 传入的 container，否则使用 #root
  const { container } = props;
  const domNode = container
    ? container.querySelector('#root')
    : document.getElementById('root');

  if (!domNode) {
    console.error('[resume-optimizer] 未找到挂载容器节点');
    return;
  }

  // 创建 React root 并渲染
  root = ReactDOM.createRoot(domNode);
  root.render(<App />);
}

/**
 * 卸载 React 应用
 *
 * 清理 React root 实例，释放 DOM 和内存。
 * 如果不清理，下次 mount 时会出现 "Target container is not a DOM element" 错误。
 */
function cleanup() {
  if (root) {
    // 在 React 18/19 中，如果在组件挂载的过程中（或 useInsertionEffect 执行期间）同步调用 root.unmount()，
    // 可能会导致 "useInsertionEffect must not schedule updates" 错误。
    // 使用 setTimeout 将卸载操作推迟到当前执行栈完成之后。
    const currentRoot = root;
    setTimeout(() => {
      try {
        currentRoot.unmount();
      } catch (e) {
        console.error('[resume-optimizer] unmount error:', e);
      }
    }, 0);
    root = null;
  }
}

// ========== qiankun 生命周期注册 ==========
// 无论是开发模式还是生产模式，vite-plugin-qiankun 都会处理生命周期的导出。
// 我们使用静态导入避免动态导入产生的竞态问题（单页应用注册生命周期找不到报错）
renderWithQiankun({
  /**
   * mount —— 挂载阶段
   * 每次子应用被激活时调用，主应用传入 container 等 props。
   */
  mount(props: QiankunProps) {
    console.log('[resume-optimizer] mount —— 子应用挂载中...', props);
    render(props);
  },
  /**
   * bootstrap —— 初始化阶段
   * 在子应用第一次加载时调用，只会执行一次。
   */
  bootstrap() {
    console.log('[resume-optimizer] bootstrap —— 子应用初始化完成');
  },
  /**
   * unmount —— 卸载阶段
   * 每次离开子应用时调用，清理 React 实例和 DOM。
   */
  unmount() {
    console.log('[resume-optimizer] unmount —— 子应用卸载中...');
    cleanup();
  },
  /**
   * update —— 更新阶段（可选）
   * 当主应用通过 app.update(props) 更新子应用 props 时调用。
   */
  update(props: QiankunProps) {
    console.log('[resume-optimizer] update —— 子应用更新 props', props);
  },
} as any);

// 独立运行模式：如果不是被 qiankun 加载，直接渲染
if (!qiankunWindow.__POWERED_BY_QIANKUN__) {
  render();
}

// ========== 生产环境 UMD 构建的兼容导出 ==========
// 在构建模式下，还需要手动导出以便 qiankun 可以识别
export async function bootstrap() {
  console.log('[resume-optimizer] export bootstrap');
}
export async function mount(props: QiankunProps = {}) {
  console.log('[resume-optimizer] export mount —— 子应用挂载中...', props);
  render(props);
}
export async function unmount(props: QiankunProps = {}) {
  console.log('[resume-optimizer] export unmount');
  cleanup();
}

