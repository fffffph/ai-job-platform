#!/usr/bin/env bash
# ============================================================
# .lefthook/check-hygiene.sh —— 提交前的工程卫生检查
#
# 【为什么单独抽成脚本文件，而不内联写在 lefthook.yml 里】
#   lefthook 在 Windows 上可能用 cmd.exe 执行 run 指令，
#   内联的多行 bash（for / if / $(...)）会直接语法报错。
#   抽成 .sh 文件 + 用 bash 显式调用，是跨平台最稳的写法。
#
# 【检查项】
#   1. 文件体积 > 2MB —— 防止 tar.gz / dist / 大截图误入仓库
#   2. 未解决的合并冲突标记（<<<<<<< / >>>>>>>）
#
# 【用法】由 lefthook 调用，参数为暂存文件列表：
#   bash .lefthook/check-hygiene.sh file1 file2 ...
# ============================================================

# -u：用到未定义变量就报错（防手滑拼错变量名）
# 刻意不加 -e：要让循环把所有文件都检查完，而不是遇到第一个问题就退出
set -uo pipefail

MAX_BYTES=$((2 * 1024 * 1024)) # 2MB 上限
EXIT_CODE=0

# 没有暂存文件时直接放行（例如只提交空 commit）
if [ "$#" -eq 0 ]; then
  exit 0
fi

for f in "$@"; do
  # 已删除的文件跳过：`git rm` 之后文件不在磁盘上，无需检查
  [ -f "$f" ] || continue

  # ---------- 检查 1：文件体积 ----------
  # wc -c 在部分平台会输出前导空格（如 macOS），用 tr 清掉再比较
  size=$(wc -c <"$f" | tr -d ' ')
  if [ "$size" -gt "$MAX_BYTES" ]; then
    echo "❌ 文件过大：$f（$((size / 1024)) KB，上限 2048 KB）"
    echo "   确实需要提交时用：git commit --no-verify（并在提交信息里说明原因）"
    EXIT_CODE=1
  fi

  # ---------- 检查 2：未解决的合并冲突标记 ----------
  # 只匹配行首的 7 个尖括号，避免误伤文档里正常提及这些符号的内容
  if grep -qE '^(<<<<<<< |>>>>>>> )' "$f" 2>/dev/null; then
    echo "❌ 发现未解决的合并冲突标记：$f"
    echo "   请先解决冲突并删除 <<<<<<< / ======= / >>>>>>> 标记"
    EXIT_CODE=1
  fi
done

exit $EXIT_CODE
