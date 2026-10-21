# AI Job Platform（CareerAI 智能求职平台）

> 一个以 **AI 为核心** 的智能求职平台：用 **微前端（qiankun）** 拆分前端、用 **LangGraph** 编排 AI 流程、用 **RAG + pgvector** 构建个人知识库，帮助你完成「简历优化 → 职位发现 → 知识库问答」全流程求职辅助。

## 🌟 核心功能

| 模块 | 说明 |
|---|---|
| 🏠 **工作台** | 功能总入口 + 个人知识库（RAG）面板，登录后首页 |
| 📄 **简历优化** | 上传 PDF/DOCX/TXT → AI 结构化分析 → 岗位匹配度评估 → 优化建议 + 多格式导出（独立 qiankun 子应用） |
| ⚡ **职位发现** | ReAct Agent 自主规划推荐职位，输出推荐原因 + 自动招呼语 + BOSS 直聘直达链接 |
| 📚 **个人知识库** | 支持 Excel 模板批量导入 / 纯文本解析，pgvector 混合检索 + LLM 增强问答，AI 决策过程全程可观测 |
| 🕘 **决策历史** | AI Trace 落库后的历史回放：按类型查看每一次 AI 执行的节点时间轴 |
| 👤 **个人中心** | 配置 DeepSeek / SiliconFlow API Key（用户级、加密存储）、维护求职画像 |
| ⚙️ **系统设置** | 权限体系 + 配置中心：菜单管理 / 角色管理 / 用户管理 / 基础配置（仅授权角色可见） |

**两大体系亮点**：
- **AI 应用体系**：单点 LLM 调用已升级为「**可编排、可记忆、可检索、可观测**」的分层架构，包含 AI Trace（决策时间轴 + 历史回放）、用户画像 Memory、知识库 RAG 三大范式落地；
- **权限体系（RBAC）**：角色-菜单多对多绑定驱动侧边栏动态渲染，菜单/按钮两级权限码，「前端隐藏 + 路由守卫 + 后端鉴权」三层生效（详见下方「权限体系」）。

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
- **鉴权**：JWT + bcrypt；RBAC 权限体系（角色-菜单绑定 + 权限码 `requirePermission`）；AES-256-GCM 加密存储用户 API Key

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
│   │   ├── dashboard/             # 工作台 / 职位发现 / 简历优化 / 个人中心 / 决策历史 / 系统设置
│   │   └── api/                   # Next.js 历史 API 路由（/api/chat、/api/parse-resume）
│   ├── components/                # 可复用组件
│   │   ├── KnowledgeBasePanel.tsx # 个人知识库 RAG 面板
│   │   ├── AITracePanel.tsx       # AI 决策过程时间轴（可观测）
│   │   └── ...                    # 首页区块 / 主题 Provider / UI 基础组件
│   ├── api/                       # 前端 API 客户端（axios 封装 + SSE 解析 + 类型）
│   │   └── modules/               # auth / jobs / knowledge / user / menu / role / config / trace 模块化请求
│   ├── lib/                       # ★ 权限与配置工具
│   │   ├── app-config.ts          # window 单例：roles / permissions / menus / configs + hasPermission()
│   │   ├── permissions.ts         # 前端权限码常量（与后端 PERMISSION_CODES 对齐）
│   │   ├── menu-icons.tsx         # 图标名 → Antd 图标组件映射
│   │   └── menu-tree.ts           # 后端菜单树 → Antd Menu items + 选中/展开计算
│   ├── hooks/  public/  styles/
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
│   │   │   ├── services/          # menu / role / userAdmin（RBAC）+ resume / auth / keys
│   │   │   ├── routes/            # menu / role / adminUser / config / ai / resume / auth
│   │   │   └── middleware/        # auth.ts（JWT 验票）+ rbac.ts（★ 权限码鉴权）
│   │   └── lib/                   # prisma 客户端 / crypto 加密工具
│   ├── prisma/                    # schema.prisma + seed.ts / seed-roles.ts（数据模型 + 角色菜单种子）
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
├── docs/                          # 设计与需求文档
│   ├── prd-rbac-menu.md           # 权限体系 PRD
│   └── arch-rbac-menu.md          # 权限体系架构设计 + 任务分解
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
npm run db:seed:roles  # 首次运行：初始化角色与菜单树（RBAC 基线，幂等可重跑）
npm run dev            # prisma generate && tsx watch（启动前自动生成 client）
```

> 首次需先准备 PostgreSQL（含 pgvector），并正确填写 `.env` 中的 `DATABASE_URL`。
> 首次初始化顺序：`npm run db:seed`（创建测试用户）→ `npm run db:seed:roles`（初始化角色与菜单树，并把 `admin@example.com` 绑定为管理员）。两个脚本均幂等，可重复执行。

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
| `/api/auth` | `POST /register` `POST /login` | 密码注册 / 登录（统一账号入口：用户名/邮箱/手机号） |
| `/api/auth` | `GET /captcha-status` `GET /captcha` `POST /send-code` | 图形验证码（预检+生成）/ 发送邮件验证码 |
| `/api/auth` | `POST /login-by-code` `POST /reset-password` | 验证码登录（未注册自动建号）/ 忘记密码重置 |
| `/api/user` | `GET/PUT /profile` `PUT /password` `PUT /identifiers` | 用户资料 / 改密码 / 修改登录标识（密码二次确认） |
| `/api/user` | `GET/PUT/DELETE /deepseek-key`、`POST /deepseek-key/test` | DeepSeek Key 配置 |
| `/api/user` | `GET/PUT/DELETE /siliconflow-key`、`POST /siliconflow-key/test` | SiliconFlow Key 配置 |
| `/api/resume` | `POST /parse` `POST /optimize` `POST /chat` | 简历解析 / 优化 / 对话 |
| `/api/ai` | `POST /resume/analyze` `POST /jobs/recommend` | AI 结构化分析 / 职位推荐（SSE） |
| `/api/ai` | `POST /knowledge/upload` `POST /knowledge/ask` `POST /knowledge/parse-text` `POST /knowledge/batch` | 知识库导入 / 问答 / 文本解析 / 批量导入 |
| `/api/ai` | `GET /knowledge/template` `GET /knowledge/file` `GET /knowledge/file-info` `DELETE /knowledge/file` | 知识库模板下载 / 文件下载 / 元信息 / 删除 |
| `/api/ai` | `GET /profile` `PUT /profile` | 求职画像读写 |
| `/api/ai` | `GET /trace/runs` `GET /trace/runs/:id` | AI 决策历史（Trace 落库回放） |
| `/api/config` | `GET /` `GET /:key`（登录可读）；`POST /` `PUT /` `PUT /:key` `DELETE /` `DELETE /:key`（需 `system:config:update`） | 系统配置中心 |
| `/api/menu` | `GET /my`（登录）；`GET /tree` `POST /` `PUT /:id` `DELETE /:id`（菜单管理权限码） | 动态菜单 + 菜单管理 |
| `/api/role` | `GET /list` `GET /:id/menus` `POST /` `PUT /:id` `DELETE /:id` `PUT /:id/menus` | 角色管理 + 菜单绑定 |
| `/api/user` | `GET /list` `PUT /:id` `PUT /:id/reset-password` `DELETE /:id` `PUT /:id/roles` `PUT /:id/status` | 用户管理（编辑 / 重置密码 / 软删除 / 分配角色 / 停用启用） |
| `/api` | `GET /health` | 健康检查 |

## 🔑 认证与账号安全

**统一账号模型**：`User.email / phone / username` 三个登录标识均可空（`@unique`），判定收敛在 `lib/identifier.ts` 单一事实源——含 `@` 是邮箱、匹配 `^1[3-9]\d{9}$` 是手机号、其余是用户名（禁纯数字防撞手机号）。查重只按判定出的单一字段精确匹配，不做 OR 模糊查询；唯一性硬约束下沉数据库（`lower(email)/lower(username)` 函数式唯一索引，`npm run db:indexes` 幂等创建）。

**登录方式**：
- **密码登录**：统一入口三标识任输，bcrypt 加盐存储；
- **验证码登录**：邮箱验证码（SMTP 真实发送，品牌化 HTML 模板），未注册可按开关自动建号（无密码账号，仅可验证码登录）；
- **忘记密码**：验证码验证身份后重置，`tokenVersion++` 吊销所有旧 Token。

**安全分层**：

| 层 | 手段 |
|---|---|
| 传输 | HTTPS/TLS（生产经 nginx，开发环境 localhost） |
| 存储 | bcrypt（cost 10）加盐哈希，密码哈希绝不外发 |
| 验证码 | 只存 `HMAC-SHA256(码, secret+target)`，一次性消费 + 场景隔离 + 错误 5 次作废 |
| 会话 | JWT + `tokenVersion` 主动吊销（改密/重置后旧 Token 立即 401） |
| 闸门 | 强制改密中间件（未改密账号只能访问改密接口） |
| 用户密钥 | API Key 走 AES-256-GCM 加密落库 |

**无密码账号规则**：验证码自动注册的账号（`password=null`）修改登录标识会被明确拒绝，引导先「设置密码」（首设免旧密码）；profile 接口返回 `hasPassword` 布尔供前端分流 UI。

**验证码频控**：同标识 60s 冷却 / 1h 5 条 + 1d 10 条 / 同 IP 1d 20 条；图形验证码分级触发（同 IP 当日第 3 次起），前端预检接口提前展示（先验证后获取）。发送通道 Provider 抽象（`MAIL_PROVIDER=console|smtp`），开发期控制台 Mock、生产切真实 SMTP 只改环境变量。

> 设计文档见 `docs/design-auth-and-user-management.md`。

## 🔐 权限体系（RBAC）

菜单、角色、用户三级关系全部落在数据库，「谁能看见什么、能点什么」由角色与菜单的绑定关系决定，侧边栏由后端菜单树动态渲染。

**数据模型**（`prisma/schema.prisma`）

| 模型 | 说明 |
|---|---|
| `Menu` | 菜单即权限点，单表自引用成树；`type` 分 `catalog` 目录 / `menu` 菜单 / `button` 按钮；`code` 唯一标识，即权限码 |
| `RoleMenu` | 角色-菜单多对多绑定（复合主键），决定某角色能看见/操作什么 |
| `Role` | 角色（`code` 创建后不可改；`isSystem` 内置角色不可删） |
| `UserRole` | 用户-角色多对多绑定（新注册用户自动绑 `user` 角色） |

**三层生效**：前端隐藏只是体验层，后端才是真正的安全边界。

| 层 | 实现 | 作用 |
|---|---|---|
| 菜单渲染 | `MainLayout` 消费 `GET /api/menu/my` + `lib/menu-tree.ts` | 不同角色看到不同侧边栏 |
| 路由守卫 | `app/dashboard/system/layout.tsx` + `lib/app-config.ts` 的 `hasPermission()` | 无权限直接访问显示 403 提示页，不白屏 |
| 接口鉴权 | `middleware/rbac.ts` 的 `requirePermission(...codes)` | 真正的拦截；实时读库，权限变更即时生效 |

**关键规则**
- **admin 强制全权**：`isAdminRole()` 是唯一短路入口（被鉴权/取权限/取菜单三处复用），admin 永不写 `RoleMenu`，其角色不可删、权限不可编辑；
- **button 是权限码而非界面元素**：它不会出现在侧边栏，也不自动生成按钮，需由代码用 `hasPermission()`（前端显隐）/ `requirePermission()`（后端鉴权）消费后才生效；
- **权限变更重新登录生效**：后端每次请求实时查库，前端菜单/按钮需重新登录刷新（不做实时推送）；
- **停用用户**：登录时拦截（`USER_DISABLED`），已登录用户的旧 token 也会被踢下线。

权限码命名规范 `模块[:资源][:动作]`（全小写，≤64 字符），如 `system` / `system:role` / `system:role:grant`。

> 设计文档见 `docs/prd-rbac-menu.md`（需求）与 `docs/arch-rbac-menu.md`（架构 + 任务分解）。

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

## ✅ 质量保障

| 项目 | 说明 |
|---|---|
| **全链路冒烟** | `bash scripts/smoke.sh` 一键跑 18 项断言：注册 → 登录 → 改密（旧 Token 吊销验证）→ 改标识（密码确认）→ admin 用户 CRUD（编辑/重置/软删除）→ 发码频控，测试账号自动清理 |
| **Lint 零告警** | 全项目 ESLint（含 React Compiler 规则 `set-state-in-effect` / `purity`）0 问题；shadcn 组件库文件带豁免注释保持与上游同步 |
| **移动端回归** | 375px 视口走查 8 个关键页面；修复 2 个真实 bug：Sider 断点回调首屏不触发、inline-collapsed 菜单弹层遮挡内容 |
| **TypeScript** | 前后端 `tsc --noEmit` 零错误，pdf2json 等松散类型用最小结构声明替代 `any` |

## 📄 许可证

MIT License