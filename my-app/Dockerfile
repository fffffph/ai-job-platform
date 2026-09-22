# ============================================
# 主应用 Dockerfile（Next.js 16 + pnpm）
# ============================================
#
# 【为什么用多阶段构建 multi-stage build】
# 一个 Dockerfile 里可以有多条 FROM，每条 FROM 开启一个"阶段"。
# 前面的阶段用来编译，最后一个阶段只保留运行必需的文件。
# 好处：最终镜像不含 TypeScript 编译器、源码、devDependencies，
#       体积能从 1GB+ 降到 200MB 左右。
#
# 构建期产物用 COPY --from=<阶段名> 跨阶段拷贝，
# 只有被拷贝的文件会进入最终镜像。
# ============================================


# ==========================================================
# 阶段 1：依赖层（deps）
# ==========================================================
# 只拷贝 package.json 和锁文件来安装依赖，不拷贝源码。
# 这是 Docker 的"层缓存"技巧：源码天天改，依赖不常改。
# 把依赖安装放在独立层，改源码时这一层能直接命中缓存，
# 不用重新 npm/pnpm install（省几分钟）。
FROM node:22-alpine AS deps
WORKDIR /app

# corepack 是 Node 自带的包管理器版本管理器。
# 用它启用 pnpm，避免 `npm i -g pnpm` 带来的全局污染。
# 本项目主应用使用 pnpm（锁文件 pnpm-lock.yaml，lockfileVersion 9.0）
RUN corepack enable && corepack prepare pnpm@11 --activate

# 先只拷贝包管理相关文件
# 注意：pnpm-workspace.yaml 也必须在 pnpm install 前 COPY 进来，
# 因为 pnpm 11 的 onlyBuiltDependencies 白名单要从这里读
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# --frozen-lockfile：严格按照锁文件安装，不允许偷偷升级。
# 若 package.json 与锁文件不一致会直接报错（CI/生产必用）
#
# 白名单写在 pnpm-workspace.yaml 的 onlyBuiltDependencies 里
# （pnpm 11 唯一认可的方式）
RUN pnpm install --frozen-lockfile --ignore-scripts


# ==========================================================
# 阶段 2：构建层（builder）
# ==========================================================
FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11 --activate

# 复用阶段 1 已装好的 node_modules（不用重装）
COPY --from=deps /app/node_modules ./node_modules

# 再拷贝全部源码
COPY . .

# ------------------------------------------------------------
# NEXT_PUBLIC_* 变量的特殊之处（面试常考点 / 部署必踩坑）
# ------------------------------------------------------------
# Next.js 里以 NEXT_PUBLIC_ 开头的变量，会在【构建时】被
# 硬编码（inline）进浏览器端的 JS 产物里，不是运行时读取。
# 所以：
#   - 必须在 build 之前用 ARG 传入，并在这一层用 ENV 承接
#   - 容器运行时再改 environment 是无效的，必须重新 build
# 这里传空字符串 = 让 axios 用相对路径，请求打到同源的 nginx
ARG NEXT_PUBLIC_API_URL=""
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

# 执行 next build。
# 因为 next.config.ts 里配了 output: 'standalone'，
# 产物会落在 .next/standalone/（自包含，含精简版 node_modules）
RUN pnpm build


# ==========================================================
# 阶段 3：运行层（runner）—— 最终镜像
# ==========================================================
FROM node:22-alpine AS runner
WORKDIR /app

# 声明生产环境（很多库据此关闭调试、开启优化）
ENV NODE_ENV=production
# Next.js 的 standalone server 监听地址。
# 不设的话容器里可能只监听 127.0.0.1，导致外部（nginx）连不上
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# 拷贝 standalone 自包含产物（含 server.js + 精简 node_modules）
COPY --from=builder /app/.next/standalone ./

# ------------------------------------------------------------
# standalone 不会自动带这两个目录，必须手动拷贝！
# 漏了的表现：页面能打开，但样式全丢、图片 404
# ------------------------------------------------------------
# 静态资源（CSS/JS chunk，文件名带 hash）
COPY --from=builder /app/.next/static ./.next/static
# 公共目录（favicon、图片等原样拷贝的文件）
COPY --from=builder /app/public ./public

# EXPOSE 只是"声明"端口，起文档作用；
# 真正对外映射靠 docker run -p 或 compose 的 ports
EXPOSE 3000

# standalone 模式直接跑 server.js，不需要 next start（也就不需要 next 依赖）
CMD ["node", "server.js"]
