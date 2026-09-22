/**
 * public-path.ts —— 动态公共路径配置
 *
 * 【为什么需要这个文件？】
 * qiankun 加载子应用时，子应用的 JS/CSS 文件是从子应用的服务器加载的。
 * 如果子应用内部有动态加载的资源（如图片、异步 chunk），这些资源的路径
 * 默认会相对于主应用的 URL 解析，导致 404 错误。
 *
 * 通过动态设置 __webpack_public_path__（Vite 中也兼容此全局变量），
 * 确保所有资源的路径都基于子应用的服务器地址。
 *
 * 例如：
 * - 主应用运行在 localhost:3000
 * - 子应用部署在 localhost:3001
 * - 子应用中有图片 <img src="/assets/logo.png" />
 * - 不设置 public path → 浏览器请求 localhost:3000/assets/logo.png（404）
 * - 设置 public path → 浏览器请求 localhost:3001/assets/logo.png（正确）
 */

// 仅在 qiankun 环境中设置动态公共路径
if ((window as any).__POWERED_BY_QIANKUN__) {
  // __INJECTED_PUBLIC_PATH_BY_QIANKUN__ 由 qiankun 自动注入
  // 其值为子应用入口 HTML 的完整 URL（如 http://localhost:3001/）
  // eslint-disable-next-line no-undef
  (window as any).__webpack_public_path__ = (window as any).__INJECTED_PUBLIC_PATH_BY_QIANKUN__;
}
