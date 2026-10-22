#!/usr/bin/env bash
# ==========================================================
# deploy/push.sh —— 一键发版到生产服务器（本地跑）
# ==========================================================
#
# 【它做了什么】
#   1. 计算溯源标签 APP_TAG（日期-git哈希-打包人），与 deploy/build.sh 规则一致
#   2. 打包源码（排除 node_modules/.next/.git 等，通常只有 4MB 左右）
#   3. scp 上传到服务器 /tmp
#   4. 服务器上解压到 /opt/careerai，并**不覆盖** .env.docker（生产密钥以服务器为准）
#   5. 用同一个 APP_TAG 构建镜像 + 滚动重启
#   6. 打印容器状态 + 冒烟结果
#
# 【用法】（在项目根目录的 Git Bash 里执行）
#   ./deploy/push.sh                 # 全量发版
#   ./deploy/push.sh server          # 只发后端
#   ./deploy/push.sh web subapp      # 只发前端两个
#   IMAGE_BUILDER=fph ./deploy/push.sh   # 指定打包人（默认取系统用户名前 4 位）
#   APP_TAG=hotfix-1 ./deploy/push.sh    # 手动指定标签（回滚/热修）
#
# 【前置条件】
#   本机已有 SSH 私钥 ~/.ssh/lighthouse_careerai，且服务器已绑定对应公钥。
#   如果私钥路径不同，改下面的 SSH_KEY。
# ==========================================================

set -euo pipefail

# ---------- 可配置项 ----------
SSH_KEY="${SSH_KEY:-$HOME/.ssh/lighthouse_careerai}"
SSH_USER="${SSH_USER:-ubuntu}"
SSH_HOST="${SSH_HOST:-82.156.111.43}"
REMOTE_DIR="${REMOTE_DIR:-/opt/careerai}"
HEALTH_URL="${HEALTH_URL:-http://${SSH_HOST}:8080/api/health}"

cd "$(dirname "$0")/.."     # 切到项目根目录

# ---------- 1. 生成溯源标签 ----------
# 本地构建用：先试 build.sh 的官方规则，取不到 git 信息就退化为时间戳
if [ -z "${APP_TAG:-}" ]; then
  BUILD_DATE="$(date +%Y%m%d)"
  GIT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo nogit)"
  BAKER="$(printf '%s' "${IMAGE_BUILDER:-$(whoami)}" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9' | cut -c1-4)"
  APP_TAG="${BUILD_DATE}-${GIT_SHA}-${BAKER:-anon}-bmanual"
fi
export APP_TAG

echo "=============================================="
echo " 发版标签: ${APP_TAG}"
echo " 目标    : ${SSH_USER}@${SSH_HOST}:${REMOTE_DIR}"
echo " 服务    : ${*:-全部}"
echo "=============================================="

# ---------- 2. 打包 ----------
# 注意：不打包 .env.docker / .env —— 生产密钥以服务器上的文件为准，
# 本地覆盖过去会把线上配置冲掉（新手最容易踩的坑）。
PKG="/tmp/careerai-deploy-$(date +%Y%m%d%H%M).tar.gz"
tar -czf "$PKG" \
  --exclude=node_modules \
  --exclude=.next \
  --exclude=.git \
  --exclude=.workbuddy \
  --exclude=dist \
  --exclude='*.log' \
  --exclude='.env' \
  --exclude='.env.docker' \
  my-app resume-optimizer \
  docker-compose.yml nginx.conf proxy_headers.conf deploy
echo "==> 已打包: $(du -h "$PKG" | cut -f1)"

# ---------- 3. 上传 ----------
scp -i "$SSH_KEY" -o BatchMode=yes "$PKG" "${SSH_USER}@${SSH_HOST}:/tmp/"
echo "==> 上传完成"

# ---------- 4. 服务器端：解压 + 构建 + 重启 ----------
# 用 ssh 执行远程脚本；APP_TAG 通过 env 前缀注入，保证三端标签一致
ssh -i "$SSH_KEY" -o BatchMode=yes "${SSH_USER}@${SSH_HOST}" APP_TAG="$APP_TAG" PKG="$PKG" REMOTE_DIR="$REMOTE_DIR" SERVICES="$*" bash -s <<'REMOTE'
set -euo pipefail
cd "$REMOTE_DIR"

# 解压覆盖源码（tar 里的路径是相对的，直接覆盖即可）
tar -xzf "$PKG" -C "$REMOTE_DIR"
rm -f "$PKG"

# 把本次标签写入 .env，后续手工 docker compose 命令也自动用同一个标签
printf 'APP_TAG=%s\n' "$APP_TAG" > "$REMOTE_DIR/.env"
chmod 600 "$REMOTE_DIR/.env"

echo "==> 开始构建（标签 $APP_TAG）"
docker compose build ${SERVICES:-}
echo "==> 滚动重启"
docker compose up -d ${SERVICES:-}
echo "==> 当前状态"
docker compose ps --format 'table {{.Name}}\t{{.Image}}\t{{.Status}}'
REMOTE

# ---------- 5. 冒烟（带等待：server 启动要跑 prisma db push + 菜单种子，约 15~30 秒）----------
echo "==> 等待服务就绪（最多 90 秒）: ${HEALTH_URL}"
CODE="000"
for i in $(seq 1 30); do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$HEALTH_URL" 2>/dev/null || echo 000)"
  if [ "$CODE" = "200" ]; then
    echo "    ✅ 就绪（第 ${i} 次探测，约 $((i * 3)) 秒）"
    break
  fi
  sleep 3
done

if [ "$CODE" != "200" ]; then
  echo "    ❌ 健康检查失败（HTTP ${CODE}），请到服务器排查："
  echo "       ssh -i ${SSH_KEY} ${SSH_USER}@${SSH_HOST} 'cd ${REMOTE_DIR} && docker compose logs --tail=80 server'"
  exit 1
fi

# 全站路由冒烟
for p in / /login /resume-optimizer/ /api/menu/my; do
  printf '    %-20s ' "$p"
  curl -s -o /dev/null -w 'HTTP %{http_code}\n' --max-time 15 "http://${SSH_HOST}:8080${p}" || true
done
echo "==> 完成。公网入口: http://${SSH_HOST}:8080"
