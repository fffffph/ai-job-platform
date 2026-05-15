# AI Job Platform (AI 驱动的智能求职平台)

这是一个基于 Next.js 和 AI 技术构建的现代化求职平台，旨在通过人工智能技术优化求职流程，提升求职者的成功率。

## 🌟 核心功能

- **智能职位匹配**: 基于技能、经验和职业目标，AI 精准推荐最适合的职位。
- **一键简历优化**: AI 深度分析简历，针对目标岗位智能优化措辞和排版。
- **AI 模拟面试**: 真实还原面试场景，AI 面试官提供专业反馈。
- **实时行业洞察**: 掌握最新行业趋势、薪资水平和技能需求。
- **职业路径规划**: 量身定制短期和长期职业发展建议。
- **隐私安全保障**: 企业级数据加密，确保求职信息安全。

## 🛠️ 技术栈

- **框架**: [Next.js 16 (App Router)](https://nextjs.org/)
- **前端库**: [React 19](https://react.dev/)
- **样式**: [Tailwind CSS 4](https://tailwindcss.com/)
- **组件库**: [Shadcn UI](https://ui.shadcn.com/) & [Ant Design](https://ant.design/)
- **动画**: [Framer Motion](https://www.framer.com/motion/)
- **图标**: [Lucide React](https://lucide.dev/)
- **验证**: [Zod](https://zod.dev/) & [React Hook Form](https://react-hook-form.com/)

## 📂 项目结构

```text
ai-job-platform/
├── my-app/              # Next.js 应用程序主目录
│   ├── app/             # App Router 路由和页面
│   ├── components/      # 可复用组件 (包含 UI 组件和业务组件)
│   ├── hooks/           # 自定义 React Hooks
│   ├── lib/             # 工具函数和库配置
│   ├── public/          # 静态资源
│   └── styles/          # 全局样式
└── README.md            # 项目文档
```

## 🚀 快速开始

### 环境准备

确保你已经安装了 [Node.js](https://nodejs.org/) (建议 v18+) 和 [pnpm](https://pnpm.io/)。

### 安装依赖

进入 `my-app` 目录并安装依赖：

```bash
cd my-app
pnpm install
```

### 运行项目

启动开发服务器：

```bash
pnpm dev
```

打开 [http://localhost:3000](http://localhost:3000) 即可在浏览器中查看效果。

## 📄 许可证

MIT License