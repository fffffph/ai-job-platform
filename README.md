# AI Job Platform (AI 驱动的智能求职平台)

这是一个基于 Next.js 和 AI 技术构建的现代化求职平台，旨在通过人工智能技术优化求职流程，提升求职者的成功率。本项目采用了**微前端架构（Qiankun）**，将庞大的系统拆分为多个独立开发、独立部署的子应用，以提升项目的可维护性和扩展性。

## 🌟 核心功能

- **智能职位匹配**: 基于技能、经验和职业目标，AI 精准推荐最适合的职位。
- **一键简历优化**: AI 深度分析简历，针对目标岗位智能优化措辞和排版（以独立微前端子应用运行）。
- **AI 模拟面试**: 真实还原面试场景，AI 面试官提供专业反馈。
- **实时行业洞察**: 掌握最新行业趋势、薪资水平和技能需求。
- **职业路径规划**: 量身定制短期和长期职业发展建议。
- **隐私安全保障**: 企业级数据加密，确保求职信息安全。

## 🛠️ 技术栈

### 主应用 (基座)
- **框架**: [Next.js 16 (App Router)](https://nextjs.org/)
- **前端库**: [React 19](https://react.dev/)
- **微前端基座**: [Qiankun](https://qiankun.umijs.org/zh)
- **样式**: [Tailwind CSS 4](https://tailwindcss.com/)
- **组件库**: [Shadcn UI](https://ui.shadcn.com/)

### 子应用 (如：简历优化模块)
- **构建工具**: [Vite](https://vitejs.dev/)
- **前端库**: [React 19](https://react.dev/)
- **组件库**: [Ant Design](https://ant.design/)
- **微前端插件**: `vite-plugin-qiankun`

## 📂 项目结构

```text
ai-job-platform/
├── my-app/              # 主应用 (基座) - Next.js
│   ├── app/             # App Router 路由和页面
│   ├── components/      # 可复用组件 (包含微前端加载器 MicroAppLoader)
│   ├── hooks/           # 自定义 React Hooks
│   ├── lib/             # 工具函数和库配置
│   ├── public/          # 静态资源
│   └── styles/          # 全局样式
├── resume-optimizer/    # 子应用 - Vite + React (简历优化模块)
│   ├── src/             # 子应用源码 (导出 qiankun 生命周期)
│   ├── vite.config.ts   # Vite 构建配置 (兼容 qiankun)
│   └── package.json
├── pnpm-workspace.yaml  # pnpm 工作区配置
└── README.md            # 项目文档
```

## 🚀 快速开始

### 环境准备

确保你已经安装了 [Node.js](https://nodejs.org/) (建议 v18+) 和 [pnpm](https://pnpm.io/)。

本项目使用 `pnpm workspace` 管理，在根目录执行依赖安装即可为所有子项目安装依赖。

### 安装依赖

进入项目根目录并安装依赖：

```bash
pnpm install
```

### 运行项目

由于采用了微前端架构，在开发时需要同时启动主应用和子应用。

1. **启动子应用 (简历优化模块)**
   子应用需优先启动以供基座拉取：
   ```bash
   cd resume-optimizer
   npm run dev
   ```
   *注意：如果遇到 pnpm 执行报错，请使用 npm 进行子应用的相关操作。*

2. **启动主应用 (基座)**
   主应用默认运行在 `3000` 端口：
   ```bash
   cd my-app
   pnpm dev
   ```

打开 [http://localhost:3000](http://localhost:3000) 即可在浏览器中查看效果。在侧边栏点击“简历优化”时，基座会动态加载并挂载 `resume-optimizer` 子应用。

## 📄 许可证

MIT License