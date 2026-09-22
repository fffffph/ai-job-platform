# AI Job Platform（CareerAI 智能求职平台）

> 一个以 **AI 为核心** 的智能求职平台：用 **微前端（qiankun）** 拆分前端、用 **LangGraph** 编排 AI 流程、用 **RAG + pgvector** 构建个人知识库，帮助你完成「简历优化 → 职位发现 → 知识库问答」全流程求职辅助。

## 🌟 核心功能

| 模块 | 说明 |
|---|---|
| 🏠 **工作台** | 功能总入口 + 个人知识库（RAG）面板，登录后首页 |
| 📄 **简历优化** | 上传 PDF/DOCX/TXT → AI 结构化分析 → 岗位匹配度评估 → 优化建议 + 多格式导出（独立 qiankun 子应用） |
| ⚡ **职位发现** | ReAct Agent 自主规划推荐职位，输出推荐原因 + 自动招呼语 + BOSS 直聘直达链接 |
| 📚 **个人知识库** | 支持 Excel 模板批量导入 / 纯文本解析，pgvector 混合检索 + LLM 增强问答，AI 决策过程全程可观测 |
| 👤 **个人中心** | 配置 DeepSeek / SiliconFlow API Key（用户级、加密存储）、维护求职画像 |

**AI 应用体系亮点**：单点 LLM 调用已升级为「**可编排、可记忆、可检索、可观测**」的分层架构，包含 AI Trace 面板（决策过程时间轴）、用户画像 Memory、知识库 RAG 三大范式落地。

## 🛠️ 技术栈

### 主应用（my-app，端口 3000）
- **框架**：Next.js 16（App Router）+ React 19
- **微前端基座**：qiankun（`loadMicroApp` 手动加载模式）
- **样式**：Tailwind CSS 4 + Ant Design 6 + Shadcn UI
- **主题**：next-themes（明暗主题，`system` 跟随系统）

### 后端（my-app/server，端口 4000）
- **服务框架**：Express 5（ES Module + TypeScript）
- **ORM / 数据库**：Prisma 7 + PostgreSQL 16（pgvector 向量检索）
- **AI 编排**：LangGraph（状态图 + ReAct Agent 循环）+ LangChain
- **模型接入**：DeepSeek（LLM，OpenAI 兼容 + Function Calling）、SiliconFlow（Embedding）
- **流式输出**：SSE（Server-Sent Events）
- **鉴权**：JWT + bcrypt，AES-256-GCM 加密存储用户 API Key

### 子应用（resume-optimizer，端口 3001）
- **构建工具**：Vite 6 + React 19 + Ant Design 6
- **微前端**：`vite-plugin-qiankun`（开发模式 useDevMode + 生产 UMD 构建）
- **文档处理**：pdfjs-dist / pdf2json / mammoth / docx / html2pdf.js

### 基础设施
- **容器化**：Docker + Docker Compose（5 容器编排）
- **反向代理**：Nginx（唯一对外端口 8080）

## 📂 项目结构

```text
ai-job-platform/
├── my-app/                        # 主应用（基座）Next.js + 内嵌后端
│   ├── app/                       # App Router 页面路由
│   │   ├── (auth)/                # 登录 / 注册
│   │   ├── dashboard/             # 工作台 / 职位发现 / 简历优化 / 个人中心
│   │   └── api/                   # Next.js 历史 API 路由（/api/chat、/api/parse-resume）
│   ├── components/                # 可复用组件
│   │   ├── KnowledgeBasePanel.tsx # 个人知识库 RAG 面板
│   │   ├── AITracePanel.tsx       # AI 决策过程时间轴（可观测）
│   │   └── ...                    # 首页区块 / 主题 Provider / UI 基础组件
│   ├── api/                       # 前端 API 客户端（axios 封装 + SSE 解析 + 类型）
│   │   └── modules/               # auth / jobs / knowledge / user 模块化请求
│   ├── hooks/  lib/  public/  styles/
│   ├── server/                    # ★ Express 后端（独立工程，见下方）
│   ├── Dockerfile                 # 主应用容器镜像
│   └── package.json
│
├── my-app/server/                 # Express 后端
│   ├── src/
│   │   ├── index.ts               # 启动入口（--env-file 加载 .env）
│   │   ├── app.ts                 # Express 实例 + 路由挂载
│   │   ├── ai/                    # ★ AI 应用体系（五层架构）
│   │   │   ├── graphs/            # LangGraph 状态图（resume / rag / jobs）
│   │   │   ├── llm/               # deepseek / embedding 客户端
│   │   │   ├── rag/               # 检索 + 文档管理 + Excel/文本解析器
│   │   │   ├── memory/            # 用户求职画像
│   │   │   ├── prompts/           # Prompt 模板（system / tasks / schemas）
│   │   │   ├── tools/             # Function Calling + MCP 工具
│   │   │   ├── stream/  trace/    # SSE 网关 / AI Trace 埋点
│   │   ├── controllers/  services/  routes/  middleware/
│   │   └── lib/                   # prisma 客户端 / crypto 加密工具
│   ├── prisma/                    # schema.prisma + seed.ts（数据模型）
│   ├── .env                       # 本地环境变量（含密钥，不入库）
│   └── Dockerfile
│
├── resume-optimizer/              # 简历优化子应用（Vite + React，UMD）
│   ├── src/
│   │   ├── main.tsx               # qiankun 生命周期（bootstrap/mount/unmount）
│   │   ├── pages/  components/  hooks/  contexts/  utils/  api/
│   ├── vite.config.ts             # UMD 构建 + qiankun 插件 + 多代理
│   └── Dockerfile
│
├── nginx.conf                     # 生产环境反向代理（唯一对外 8080）
├── proxy_headers.conf             # 代理转发通用头
├── docker-compose.yml             # 5 容器一键编排
├── .env.docker                    # Docker 部署环境变量（含密钥，不入库）
├── ai-architecture-design.md      # AI 应用体系架构设计文档
├── docker-deploy-plan.md          # Docker 部署方案说明
└── README.md                      # 本文档
```

## 🚀 快速开始

### 环境要求

| 依赖 | 版本要求 |
|---|---|
| Node.js | ≥ 18（开发实测 v22） |
| 包管理器 | pnpm（主应用为 pnpm workspace） |
| PostgreSQL | 16（含 pgvector 扩展，本地开发需自建） |
| Docker | 可选，仅生产部署需要 |

### 一、本地开发启动

需要同时启动三端：**后端（4000）→ 子应用（3001）→ 主应用（3000）**。

```bash
# 1. 安装主应用与子应用依赖
cd my-app && pnpm install
cd ../resume-optimizer && pnpm install
cd ..
```

**① 启动后端（Express，端口 4000）**

```bash
cd my-app/server
cp .env.example .env   # 从模板复制，再填写 DATABASE_URL / JWT_SECRET / API Key
npm install            # server 独立使用 npm（非 pnpm）
npm run db:push        # 首次运行：同步 Prisma schema 到数据库
npm run dev            # prisma generate && tsx watch（启动前自动生成 client）
```

> 首次需先准备 PostgreSQL（含 pgvector），并正确填写 `.env` 中的 `DATABASE_URL`。

**② 启动子应用（简历优化，端口 3001）**

```bash
cd resume-optimizer
pnpm dev               # vite-plugin-qiankun useDevMode 模式（关闭 HMR）
```

**③ 启动主应用（Next.js，端口 3000）**

```bash
cd my-app
pnpm dev
```

打开 **http://localhost:3000**，注册/登录后进入工作台。侧边栏点击「简历优化」时，基座会动态加载并挂载 `resume-optimizer` 子应用。

> ⚠️ 子应用需在 `/dashboard/resume` 页面被访问前启动，否则 qiankun 会因拉取不到 `http://localhost:3001` 的资源而报错。

### 二、Docker 一键部署（生产）

```bash
# 1. 准备密钥文件 .env.docker（参照下方「环境变量」小节）
# 2. 一键构建并启动 5 个容器
docker compose up -d --build
```

编排的 5 个容器（`docker-compose.yml`）：

| 容器 | 服务 | 说明 |
|---|---|---|
| `careerai-postgres` | postgres:16-alpine | 数据库（仅内网，含 healthcheck） |
| `careerai-server` | Express 后端 | 仅内网 `:4000` |
| `careerai-web` | Next.js 主应用 | 仅内网 `:3000` |
| `careerai-subapp` | 子应用静态资源 | 仅内网 `:80` |
| `careerai-nginx` | nginx:alpine | **唯一对外端口 `:8080`** |

访问 **http://localhost:8080**（nginx 按路径同源分发，无跨域问题）：

```
/                   → web（Next.js 页面）
/api/auth/* /api/user/* /api/resume/* → server（Express）
/resume-optimizer/* → subapp（子应用 UMD 静态资源）
```

## 🔑 环境变量

### 后端 `.env`（my-app/server/.env，本地开发）

| 变量 | 必填 | 说明 |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL 连接串，如 `postgresql://postgres:postgres@localhost:5432/careerai?schema=public` |
| `JWT_SECRET` | ✅ | JWT 签名密钥（`openssl rand -base64 32` 生成） |
| `JWT_EXPIRES_IN` | - | 令牌有效期，默认 `7d` |
| `BCRYPT_SALT_ROUNDS` | - | 密码加密强度，默认 `10` |
| `DEEPSEEK_API_KEY` | - | DeepSeek 服务端兜底 Key（用户未配置时使用，可留空） |
| `DEEPSEEK_ENCRYPTION_KEY` | - | 用户 Key 加密密钥（AES-256-GCM，留空回退 JWT_SECRET 派生） |
| `SILICONFLOW_API_KEY` | - | SiliconFlow Embedding 服务端兜底 Key |
| `PORT` | - | 后端端口，默认 `4000` |

### Docker 部署 `.env.docker`（项目根目录）

字段与后端 `.env` 基本一致，另含数据库初始化变量 `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB`。该文件由 `docker-compose.yml` 的 `env_file` 注入容器。

> 📝 各目录均提供了脱敏模板：`my-app/server/.env.example`、`my-app/.env.example`、`resume-optimizer/.env.example`、`.env.docker.example`，复制为对应文件名并填写即可。
> 🔒 `.env` / `.env.docker` 等真实密钥文件已被 `.gitignore` 排除，**切勿提交**；`.env.example` 模板会正常入库。

## 📡 API 概览

后端统一挂载于 Express，鉴权接口需携带 `Authorization: Bearer <token>`（登录后由前端自动注入）。

| 前缀 | 主要端点 | 说明 |
|---|---|---|
| `/api/auth` | `POST /register` `POST /login` | 注册 / 登录 |
| `/api/user` | `GET/PUT /profile` `PUT /password` | 用户资料 / 改密码 |
| `/api/user` | `GET/PUT/DELETE /deepseek-key`、`POST /deepseek-key/test` | DeepSeek Key 配置 |
| `/api/user` | `GET/PUT/DELETE /siliconflow-key`、`POST /siliconflow-key/test` | SiliconFlow Key 配置 |
| `/api/resume` | `POST /parse` `POST /optimize` `POST /chat` | 简历解析 / 优化 / 对话 |
| `/api/ai` | `POST /resume/analyze` `POST /jobs/recommend` | AI 结构化分析 / 职位推荐（SSE） |
| `/api/ai` | `POST /knowledge/upload` `POST /knowledge/ask` `POST /knowledge/parse-text` `POST /knowledge/batch` | 知识库导入 / 问答 / 文本解析 / 批量导入 |
| `/api/ai` | `GET /knowledge/template` `GET /knowledge/file` `GET /knowledge/file-info` `DELETE /knowledge/file` | 知识库模板下载 / 文件下载 / 元信息 / 删除 |
| `/api/ai` | `GET /profile` `PUT /profile` | 求职画像读写 |
| `/api` | `GET /health` | 健康检查 |

## 🧠 AI 应用体系（五层架构）

后端 `server/src/ai/` 目录按五层组织，是理解本项目 AI 能力的入口：

| 层 | 目录 | 职责 |
|---|---|---|
| 应用层 | `app.ts` / 前端组件 | 接收请求、SSE 消费、AI Trace 面板展示 |
| 编排层 | `ai/graphs/` | LangGraph 状态图（`ResumeGraph` / `RAGGraph` / `JobGraph`） |
| 能力层 | `ai/prompts/` `ai/tools/` `ai/rag/` | Prompt 模板、Function Calling / MCP 工具、检索器 |
| Memory 层 | `ai/memory/` + `ai/rag/` | 用户求职画像、pgvector 知识库 |
| 基础设施层 | `ai/llm/` `ai/stream/` `ai/trace/` | DeepSeek / Embedding、SSE 网关、Trace 埋点 |

三大 AI 范式落地：**简历优化 → Agent 编排**、**知识库 → RAG**、**职位发现 → ReAct 自主规划**。每一步决策（调了什么工具、检索到什么、生成什么）都通过 AI Trace 面板透明可见，符合「学习导向」的设计目标。

## 📄 许可证

MIT License