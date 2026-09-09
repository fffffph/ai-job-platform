# CareerAI 求职平台 — Docker 部署方案（待审查）

> 目标：4 容器编排，对外只暴露一个端口，`docker compose up -d` 一键启动。
> 状态：**方案阶段，未执行任何操作**，审查通过后再实施。

---

## 一、目标架构

```
                         宿主机端口 8080
                              │
                    ┌─────────▼──────────┐
                    │   nginx 容器 :80    │
                    │   (反向代理入口)     │
                    └──┬──────┬──────┬───┘
           /           │      │      │  /resume-optimizer/*
           (主应用)     │      │      │  (子应用静态资源)
                       │      │      │
              ┌────────▼─┐ ┌──▼───────┐ ┌▼──────────────┐
              │ web 容器  │ │ server   │ │ subapp 静态文件 │
              │ Next.js  │ │ Express  │ │ (nginx 托管)   │
              │ :3000    │ │ :4000    │ │ :80           │
              └──────────┘ └──┬───────┘ └───────────────┘
                              │
                       ┌──────▼───────┐
                       │ postgres 容器 │
                       │ :5432 (仅内网) │
                       │ volume 持久化  │
                       └──────────────┘
```

| 容器 | 基础镜像 | 职责 | 端口 |
|------|---------|------|------|
| `nginx` | nginx:alpine | 统一入口：`/`→主应用，`/api/*`→后端，`/resume-optimizer/*`→子应用 | **8080:80**（对外唯一端口）|
| `web` | node:22-alpine | Next.js 16 主应用（standalone 模式） | 3000（仅内网）|
| `server` | node:22-alpine | Express API + Prisma + DeepSeek 调用 | 4000（仅内网）|
| `postgres` | postgres:16-alpine | 数据库，named volume 持久化 | 5432（仅内网）|
| `subapp` | node 构建 → nginx:alpine 托管 | 简历优化子应用 UMD 静态资源 | 80（仅内网）|

---

## 二、前置代码改造（3 处，各 1-3 行）

### ① `my-app/next.config.ts` — 开启 standalone 输出

```ts
const nextConfig: NextConfig = {
  output: 'standalone',   // ← 新增：Docker 部署必需，产物自包含
  // ...原有配置不动
};
```

### ② `resume-optimizer/src/api/client.ts` — baseURL 改相对路径

```ts
// 改前（写死，容器内无法跨机访问）：
baseURL: "http://localhost:4000",

// 改后（同源走 nginx 反代，开发环境 Vite proxy 不受影响）：
baseURL: import.meta.env.PROD ? "" : "http://localhost:4000",
```

### ③ `my-app/server/package.json` — start 脚本去掉 --env-file

```json
"start": "node dist/index.js"
```
> 容器内环境变量由 compose 直接注入，`.env` 文件不需要进镜像（也避免密钥打进镜像层）。
> 本地开发仍用 `npm run dev`（tsx watch --env-file），互不影响。

---

## 三、新增文件清单（7 个）

```
ai-job-platform/
├── docker-compose.yml              # 编排入口
├── .env.docker                     # 环境变量模板（JWT/DB/DeepSeek Key）
├── nginx.conf                      # 入口反代规则
├── my-app/
│   ├── Dockerfile                  # Next.js 多阶段构建
│   └── .dockerignore
├── my-app/server/
│   ├── Dockerfile                  # Express 多阶段构建 + 迁移启动
│   └── .dockerignore
└── resume-optimizer/
    ├── Dockerfile                  # Vite UMD 构建 → nginx 托管
    ├── nginx-subapp.conf           # 子应用静态托管 + HTML 壳
    └── .dockerignore
```

### 关键文件设计要点

**docker-compose.yml**（核心结构预览）：
```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER/PASSWORD/DB: postgres/postgres/careerai
    volumes: [pgdata:/var/lib/postgresql/data]
    healthcheck: pg_isready   # server 依赖此健康检查
    # 不映射端口到宿主机（仅内部网络）

  server:
    build: ./my-app/server
    environment:
      DATABASE_URL: postgresql://postgres:postgres@postgres:5432/careerai
      JWT_SECRET / DEEPSEEK_API_KEY: 来自 .env.docker
    depends_on: { postgres: { condition: service_healthy } }
    command: sh -c "npx prisma migrate deploy && node dist/index.js"

  web:
    build: ./my-app
    environment:
      NODE_ENV: production
      NEXT_PUBLIC_API_URL: ""        # 同源相对路径，走 nginx
    depends_on: [server]

  subapp:
    build: ./resume-optimizer

  nginx:
    image: nginx:alpine
    ports: ["8080:80"]
    volumes: ["./nginx.conf:/etc/nginx/conf.d/default.conf:ro"]
    depends_on: [web, server, subapp]

volumes:
  pgdata:
```

**nginx.conf 路由规则**：
```nginx
location /api/          → proxy_pass http://server:4000;   # 后端 API
location /resume-optimizer/ → proxy_pass http://subapp:80; # 子应用静态
location /              → proxy_pass http://web:3000;      # Next.js
```

**子应用 HTML 壳**（解决 UMD 构建无 index.html 的问题）：
构建后在镜像里生成一个最小 HTML：
```html
<!DOCTYPE html>
<html><body>
  <script src="/resume-optimizer/index.js"></script>
</body></html>
```
qiankun `loadMicroApp` 的 entry `/resume-optimizer/` 会 fetch 这个 HTML 并提取 script 执行 —— 与现有 `MicroAppLoader.tsx:47` 的生产路径配置完全吻合，**主应用代码零改动**。

**server 容器启动流程**：
```
1. npx prisma migrate deploy   # 应用未执行的迁移
2. node dist/index.js          # 启动 Express :4000
```

---

## 四、环境变量（.env.docker 模板）

```bash
# ---------- 数据库 ----------
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres          # 生产请改强密码
POSTGRES_DB=careerai

# ---------- JWT ----------
JWT_SECRET=careerai-dev-jwt-secret-change-in-production

# ---------- AI ----------
DEEPSEEK_API_KEY=sk-xxx             # 留空则后端自动 Mock 兜底
```

> 密钥不进镜像、不进 git（.gitignore 加 `.env.docker`）。

---

## 五、实施步骤（审查通过后执行）

```bash
# 1. 构建全部镜像（首次约 5-10 分钟，Windows 磁盘 IO 慢属正常）
docker compose build

# 2. 启动全部容器（后台运行）
docker compose up -d

# 3. 查看启动状态与健康检查
docker compose ps
docker compose logs -f server    # 确认 prisma migrate + Express 启动日志

# 4. 访问验证
#    主应用：      http://localhost:8080
#    登录 → 简历优化页面（验证 qiankun 子应用加载）
#    健康检查：    http://localhost:8080/api/health
```

### 验证清单

| # | 检查项 | 预期 |
|---|--------|------|
| 1 | `docker compose ps` | 4 个容器全部 Up / healthy |
| 2 | `GET /api/health` | `{"success":true,...}` |
| 3 | 登录/注册 | 正常（数据库连通）|
| 4 | 简历优化页面 | 子应用 UMD 加载成功（**重点**）|
| 5 | 上传 PDF → 优化 | parse + optimize 链路通 |
| 6 | 对话修改 | chat 接口正常（或 Mock 兜底）|
| 7 | `docker compose down` | 正常停止，`pgdata` 卷保留数据 |

---

## 六、风险与待验证项（如实列出）

| # | 风险 | 等级 | 应对 |
|---|------|------|------|
| 1 | **子应用 UMD 生产加载**：开发环境一直走 Vite dev server（:3001），生产 UMD + qiankun 组合尚未实测过 | ⚠️ 中 | 部署后第一时间验证简历页；若加载失败，备选方案：主应用把子应用 dist 拷进 `public/resume-optimizer/`，省掉独立容器 |
| 2 | Next.js standalone 产物需要 `.next/static` 和 `public` 手动复制到 runner 层（标准做法，容易漏） | 低 | Dockerfile 中明确 COPY |
| 3 | Windows Docker 构建慢（node_modules 层重复传 IO） | 低 | `.dockerignore` 排除 node_modules/.next/dist |
| 4 | `NEXT_PUBLIC_*` 是构建时注入，改配置需重新 build web 镜像（不是重启） | 低 | 文档标注即可 |
| 5 | 端口 8080 若被占用 | 低 | compose 里改成其他端口一行搞定 |
| 6 | 现有本地开发流程（3000/3001/4000 直连）与 Docker 模式并存互不干扰 | 无 | Docker 网络隔离，本地 dev 不受影响 |

---

## 七、回滚 / 清理

```bash
docker compose down          # 停止并删容器（数据卷保留）
docker compose down -v       # 连数据一起清（谨慎）
docker compose build --no-cache web   # 某个镜像出问题强制重建
```

---

**审查要点建议**：① 架构是否接受 nginx 统一入口（替代当前三端口直连）② 3 处代码改造是否同意 ③ 端口 8080 是否 OK ④ DeepSeek Key 走 .env.docker 注入是否 OK。确认后我按第五节步骤实施。
