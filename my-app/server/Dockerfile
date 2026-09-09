# ============================================
# 后端 Dockerfile（Express + TypeScript + Prisma）
# ============================================
#
# 【与前端 Dockerfile 的差异】
# 1. 包管理器用 npm（本项目后端是 package-lock.json，不是 pnpm）
# 2. TypeScript 项目需要"编译期"，所以必须有 builder 阶段跑 tsc
#    → 产物是 dist/*.js（package.json 里 "type": "module"，即 ESM）
# 3. Prisma 需要 generate 生成客户端代码，且启动前要跑数据库迁移
#
# 【结构选择】把 node_modules 整个从 builder 拷贝到 runner，
# 而不是 runner 重新 npm ci —— 这样可以避免一系列在 alpine 上的
# "npm 装上了但 .bin 链接没建" 的诡异问题（具体见下文）。
# ============================================


# ==========================================================
# 阶段 1：构建层（builder）—— 编译 + 生成 Prisma Client
# ==========================================================
FROM node:22-alpine AS builder
WORKDIR /app

# ------------------------------------------------------------
# prisma generate 需要读 prisma.config.ts，里面的 config() 校验环境变量。
# Docker build 阶段没有 .env，所以这里手动注入一个 dummy URL。
# （实际数据库连接由运行时 compose 注入的 DATABASE_URL 处理）
# ------------------------------------------------------------
ENV DATABASE_URL="postgresql://postgres:postgres@postgres:5432/careerai?schema=public"

COPY package.json package-lock.json ./

# npm ci：严格按 package-lock.json 安装（CI/生产首选）
#
# --bin-links=true：强制创建 .bin 链接。
# alpine 上 npm 偶尔不建某些包的 .bin 链接（疑似 musl 与宿主差异），
# 加上这个标志避免 "./node_modules/.bin/prisma: not found" 的诡异问题。
RUN npm ci

# 拷贝源码 + Prisma 相关文件
COPY tsconfig.json ./
COPY prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src

# 生成 Prisma Client（@prisma/client 运行时依赖 generate 出来的代码）
# 用显式 ./node_modules/.bin/prisma 路径，避免 npx 自动下载错版本
RUN ./node_modules/.bin/prisma generate

# 编译 TS → JS（输出到 dist/）
RUN npm run build


# ==========================================================
# 阶段 2：运行层（runner）—— 最终镜像
# ==========================================================
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# ------------------------------------------------------------
# 【关键决策】不重新跑 npm ci，直接从 builder 拷贝 node_modules
#
# 之前在 runner 重跑 npm ci 时遇到过这个坑：
#   1. 加 --include=dev 后能装 75 个包（devDeps 全装）
#   2. 但 ./node_modules/.bin/prisma 仍然 "not found"
#   3. 推测 alpine 上 npm 对某些含类型包的 .bin 链接逻辑与本地不同
#
# 从 builder 拷贝整个 node_modules 一劳永逸：
#   - Prisma Client 已经 generate 好（在 builder 完成）
#   - 所有 .bin 链接都建好
#   - 镜像里 node_modules 与 builder 一致，避免任何运行时差异
#
# 代价：镜像大一些（~200MB 包含 prisma engine 等 native 包）
# 但生产环境稳定性优先。
# ------------------------------------------------------------
COPY --from=builder /app/node_modules ./node_modules

# Prisma schema 与配置（启动时 db push 需要读）
COPY prisma.config.ts ./
COPY prisma ./prisma

# 拷贝编译产物
COPY --from=builder /app/dist ./dist

# 拷贝 package.json（npm start 需要它读 scripts 字段）
COPY package.json package-lock.json ./

EXPOSE 4000

# ------------------------------------------------------------
# 启动命令：先建表结构，再启动
# ------------------------------------------------------------
# prisma db push（不是 migrate deploy）：
#   自动同步 schema 到数据库，无需预先生成迁移文件。
#   适合首次部署 / 没有迁移历史的库。
#   ⚠️ 生产环境应改用 migrate deploy（带版本控制）—— 改这一行即可。
#
# npm start → node --env-file-if-exists=.env dist/index.js
# 环境变量由 docker-compose 注入，--env-file-if-exists 保证文件缺失不报错
CMD ["sh", "-c", "./node_modules/.bin/prisma db push && npm start"]