#!/usr/bin/env bash
# ============================================
# deploy/build.sh —— 带溯源标签的一键打包脚本
# ============================================
#
# 【做什么】
# 自动生成符合镜像命名规范的 APP_TAG，注入 docker-compose 构建：
#   <日期>-<分支可选>-<git短哈希>-<打包人>-<构建号>
# 示例：
#   主干构建   20261018-a1b2c3d-fph-b42
#   分支构建   20261018-featlogin-a1b2c3d-fph-b42
#
# 【怎么用】
#   ./deploy/build.sh            # 构建全部三个镜像并重启
#   ./deploy/build.sh server     # 只构建/重启指定服务（参数透传给 compose）
#   IMAGE_BUILDER=fph ./deploy/build.sh   # 手动指定打包人（默认取系统用户名）
#   APP_TAG=自定义 ./deploy/build.sh      # 完全接管标签（CI 高级用法）
#
# 【为什么脚本生成而不是写在 compose 里】
# compose 变量插值不支持执行命令，日期/git 哈希必须由外部注入；
# 集中在脚本里生成，本地、CI、服务器三端行为一致。
# ============================================

set -euo pipefail

# 切到项目根目录（脚本在 deploy/ 下，往上走一级）
cd "$(dirname "$0")/.."

# ---------- 步骤 1：生成标签各字段 ----------

# 日期：yyyyMMdd，肉眼判断新旧、按日期批量清理过期镜像
BUILD_DATE="$(date +%Y%m%d)"

# Git 短哈希：溯源黄金标准，git checkout <hash> 即可复现构建现场
GIT_SHA="$(git rev-parse --short HEAD)"

# 分支：仅非主干构建写入（主干省略，让标签更短）
# 清洗规则：转小写、去非法字符、截断 12 字符 —— tag 只允许 小写/数字/.-_/
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
BRANCH_SEG=""
if [ "${BRANCH}" != "main" ] && [ "${BRANCH}" != "master" ]; then
  BRANCH_SEG="$(printf '%s' "${BRANCH}" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9-' | cut -c1-12)-"
fi

# 打包人：优先取 IMAGE_BUILDER 环境变量，否则取系统用户名
# 清洗规则：转小写、只留字母数字、截断 4 字符（如 Administrator → admi）
BAKER="$(printf '%s' "${IMAGE_BUILDER:-$(whoami)}" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9' | cut -c1-4)"
BAKER="${BAKER:-anon}"

# 构建号：CI 里取流水线自增号，本地构建标记为 manual
BUILD_NO="${CI_PIPELINE_ID:-manual}"

# ---------- 步骤 2：组装标签（外部已指定 APP_TAG 则尊重外部） ----------
if [ -z "${APP_TAG:-}" ]; then
  APP_TAG="${BUILD_DATE}-${BRANCH_SEG}${GIT_SHA}-${BAKER}-b${BUILD_NO}"
fi
export APP_TAG

echo "==> 镜像标签: ${APP_TAG}"
echo "==> 构建字段: 日期=${BUILD_DATE} 分支=${BRANCH} 提交=${GIT_SHA} 打包人=${BAKER} 构建号=${BUILD_NO}"

# ---------- 步骤 3：构建 + 滚动更新 ----------
# 参数透传给 compose：./deploy/build.sh server 只构建 server
if [ "$#" -gt 0 ]; then
  docker compose build "$@"
  docker compose up -d "$@"
else
  docker compose build
  docker compose up -d
fi

# ---------- 步骤 4：展示结果 ----------
echo ""
echo "==> 当前运行的镜像："
docker compose ps --format "table {{.Name}}\t{{.Image}}\t{{.Status}}"
