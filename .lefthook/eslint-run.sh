#!/usr/bin/env bash
# ============================================================
# .lefthook/eslint-run.sh —— 带「文件过滤 + 空列表保护」的 ESLint 包装器
#
# 【为什么需要这个脚本（两个真实事故，都不是假想）】
#
# 事故 1：跨项目误检
#   lefthook 的 {push_files} 是「本次推送涉及的全部文件」，
#   它【不受】job 的 glob / exclude 过滤 —— glob 只决定 job 要不要启动，
#   不改变 {push_files} 的内容。
#   实测后果：推送 my-app/server/src/xxx.ts 时，
#   root 在 my-app/ 的 eslint-web 也会收到这个文件，
#   于是用 Next 的规则集去分析后端代码，耗时 58.6s 且报错误的规则。
#
# 事故 2：空列表退化成全量扫描
#   当过滤后没有任何文件，命令变成 `eslint --cache`（无文件参数），
#   而 ESLint 的默认行为是「没给文件就扫描当前目录全部」，
#   于是悄悄把整个项目 lint 一遍（实测 10s + 一堆无关的历史问题）。
#
# 【用法】
#   bash .lefthook/eslint-run.sh <工作目录> <排除前缀> <eslint入口> <是否缓存0|1> <文件...>
#
#   例：
#   bash .lefthook/eslint-run.sh my-app my-app/server/ node_modules/eslint/bin/eslint.js 1 a.ts b.tsx
#
#   <排除前缀> 传 "" 表示不排除；路径均以「仓库根」为基准。
# ============================================================

set -uo pipefail

WORKDIR="${1:-}"
EXCLUDE_PREFIX="${2:-}"
ESLINT_BIN="${3:-}"
USE_CACHE="${4:-0}"
# 用 "-" 表示「不排除」：YAML 里传空字符串容易被各层 shell 吃掉，
# 统一用占位符更可靠
[ "$EXCLUDE_PREFIX" = "-" ] && EXCLUDE_PREFIX=""
shift 4 || true

# ---------- 1. 过滤文件 ----------
files=()
for f in "$@"; do
  # git 输出可能带 ./ 前缀，先归一化
  norm="${f#./}"

  # 排除非本项目的路径（前缀匹配）
  if [ -n "$EXCLUDE_PREFIX" ]; then
    case "$norm" in
      "$EXCLUDE_PREFIX"*) continue ;;
    esac
  fi

  # 只保留源码扩展名，防止把 .md / .json 塞给 ESLint
  case "$norm" in
    *.ts | *.tsx | *.js | *.jsx) files+=("$norm") ;;
  esac
done

# ---------- 2. 空列表保护：宁可跳过，绝不退化成全量扫描 ----------
if [ "${#files[@]}" -eq 0 ]; then
  echo "（本次推送无匹配文件，跳过）"
  exit 0
fi

# ---------- 3. 转成相对工作目录的路径，再执行 ----------
rel=()
for f in "${files[@]}"; do
  case "$f" in
    "$WORKDIR"/*) rel+=("${f#"$WORKDIR"/}") ;;
    *) rel+=("$f") ;;
  esac
done

cd "$WORKDIR" || {
  echo "❌ 无法进入目录：$WORKDIR"
  exit 1
}

args=(--no-warn-ignored)
# 注意：类型感知规则不要开缓存（见 lefthook.yml 中 eslint-server 的说明）
if [ "$USE_CACHE" = "1" ]; then
  args+=(--cache)
fi

echo "检查 ${#rel[@]} 个文件：${rel[*]}"
node "$ESLINT_BIN" "${args[@]}" "${rel[@]}"
