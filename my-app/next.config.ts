import type { NextConfig } from "next";

/**
 * Next.js 构建配置 —— CareerAI 微前端主应用
 *
 * 【微前端架构配置说明】
 * 1. serverActions.bodySizeLimit: 10MB，支持大文件上传（简历 PDF/DOCX）
 *    - 该配置服务于 /api/parse-resume 路由（接收子应用上传的简历文件）
 *    - 以及原有的 Server Action parseResume（向后兼容）
 *
 * 2. headers(): 配置 CORS 跨域头
 *    - 子应用运行在 localhost:3001（开发环境）或其他域名（生产环境）
 *    - 子应用通过 fetch 调用主应用的 /api/parse-resume 和 /api/chat 接口
 *    - 需要允许跨域请求，否则浏览器会拦截子应用的 API 调用
 *
 * 【子应用 API 调用链】
 * 子应用（localhost:3001）→ fetch('/api/parse-resume') → Vite proxy 转发 → 主应用（localhost:3000）
 * 子应用（localhost:3001）→ fetch('/api/chat')          → Vite proxy 转发 → 主应用（localhost:3000）
 */
const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // 支持最大 10MB 的文件上传（简历文件解析需要）
      bodySizeLimit: '10mb',
    },
  },

  /**
   * API 路由跨域配置
   *
   * 为所有 /api/ 路由添加 CORS 响应头，允许子应用跨域调用。
   * 开发环境中子应用运行在独立端口（localhost:3001），
   * 若不加 CORS 头，浏览器会阻止跨域请求。
   *
   * 生产环境中，如果主应用和子应用部署在同一域名下，
   * 可以移除此配置或缩小 allowedOrigins 范围。
   */
  async headers() {
    return [
      {
        // 匹配所有 API 路由
        source: '/api/:path*',
        headers: [
          // 允许所有来源的跨域请求（生产环境建议限制为子应用域名）
          { key: 'Access-Control-Allow-Origin', value: '*' },
          // 允许的请求方法
          { key: 'Access-Control-Allow-Methods', value: 'GET, POST, PUT, DELETE, OPTIONS' },
          // 允许的请求头
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization' },
        ],
      },
    ];
  },
};

export default nextConfig;
