# ============================================
# 子应用 Dockerfile（Vite UMD 构建 + nginx 静态托管）
# ============================================
#
# 【这个容器的定位】
# 子应用不是"网站"，而是被 qiankun 动态加载的一块 JS。
# 生产环境它需要一个 HTTP 地址提供静态文件，
# 所以用 nginx 托管构建产物即可（不需要 Node 运行时）。
#
# 构建流程：Node 环境编译 → 产物拷贝进 nginx 镜像 → 镜像里只有 nginx
# 最终镜像只有几十 MB。
# ============================================


# ==========================================================
# 阶段 1：构建层（builder）—— 产出 dist/index.js
# ==========================================================
FROM node:22-alpine AS builder
WORKDIR /app

# 子应用同样用 pnpm（pnpm-lock.yaml）
RUN corepack enable && corepack prepare pnpm@11 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# ------------------------------------------------------------
# pnpm 11 安全策略：默认拒绝依赖跑 postinstall 脚本。
# 但 esbuild/core-js 必须跑 postinstall 才能完成平台适配。
#
# 白名单写在 pnpm-workspace.yaml 的 onlyBuiltDependencies 里
# （pnpm 11 唯一认可的方式，package.json 的 ppm 字段已废弃）
# ------------------------------------------------------------
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY . .

# 产出：
#   dist/index.js      —— UMD 包（qiankun 真正加载的文件）
#   dist/index.js.map  —— sourcemap
# 注意：库模式不会生成 index.html，入口 HTML 由 docker/index.html 提供
RUN pnpm build


# ==========================================================
# 阶段 2：运行层（nginx 静态托管）
# ==========================================================
FROM nginx:alpine

# 把 UMD 产物放到 nginx 默认根目录的 resume-optimizer/ 子目录下。
# 对应访问路径 /resume-optimizer/index.js
COPY --from=builder /app/dist /usr/share/nginx/html/resume-optimizer

# 拷贝 qiankun 需要的入口 HTML 壳（上面 dist/index.html 由它提供）
COPY docker/index.html /usr/share/nginx/html/resume-optimizer/index.html

# 子应用自己的 nginx 配置（静态托管 + CORS 头）
COPY nginx-subapp.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

# nginx 镜像自带前台启动命令，无需写 CMD
