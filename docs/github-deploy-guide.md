# 走 GitHub 发版：三种路线与落地步骤

> 现状：仓库 `github.com/fffffph/ai-job-platform`，当前分支 `dev_20261018`，`.env.docker` 已被 gitignore（安全 ✅）
> 服务器：`ubuntu@82.156.111.43:/opt/careerai`，入口 `http://82.156.111.43:8080`
> 实测网络：服务器 → GitHub **SSH 22 通、codeload/ghcr 快，但 github.com 网页 15s+**（拉取式偏慢）

---

## 一、三条路线怎么选

| | A. 服务器拉取 | **B. Actions 推送（推荐）** | C. CI 构建镜像 |
|---|---|---|---|
| 流程 | push → 服务器 `git pull` → 构建 | push → Actions → rsync + SSH → 服务器构建 | push → Actions 构建镜像 → 推 GHCR → 服务器 pull |
| 依赖 | 服务器要能稳定访问 GitHub（**实测偏慢**） | Actions 主动连服务器，服务器不用访问 GitHub | 服务器要能拉 ghcr（实测 1.1s，可接受） |
| 构建占用 | 服务器 2G 内存（现有方式） | 服务器 2G 内存（现有方式） | **服务器不构建**，只 pull，内存压力最小 |
| 密钥管理 | 服务器存 GitHub Deploy Key（只读） | GitHub Secrets 存 SSH 私钥 | 两套密钥 + 镜像仓库权限 |
| 回滚 | `git checkout 旧commit` + 重建 | 重跑旧流水线 / 改 APP_TAG 切镜像 | 直接切镜像标签（最快） |
| 复杂度 | 低 | **低** | 高 |
| 适合 | 想最简单、能接受慢 | **当前阶段最合适** | 后期正式上线、要审计 |

**结论**：现在走 **B**；等镜像发布流程稳定、或想摆脱"服务器构建"再升级到 C。

---

## 二、路线 B 落地（5 步，约 15 分钟）

### 第 1 步｜生成 CI 专用密钥（本地执行，别复用你现在的登录密钥）

```bash
ssh-keygen -t ed25519 -N "" -C "github-actions-deploy" -f ~/.ssh/gh_deploy
cat ~/.ssh/gh_deploy.pub
```

把公钥追加到服务器（保持你现有登录密钥不变）：

```bash
ssh -i ~/.ssh/lighthouse_careerai ubuntu@82.156.111.43 \
  "echo 'ssh-ed25519 AAAA...你的公钥... github-actions-deploy' >> ~/.ssh/authorized_keys"
```

> 为什么单独一把：CI 密钥一旦泄露可单独吊销（从 `authorized_keys` 删一行即可），不影响你日常登录。

### 第 2 步｜配置仓库 Secrets

GitHub 仓库 → **Settings → Secrets and variables → Actions → New repository secret**：

| Name | Value | 说明 |
|------|-------|------|
| `SSH_HOST` | `82.156.111.43` | 服务器 IP |
| `SSH_USER` | `ubuntu` | 登录用户 |
| `SSH_PRIVATE_KEY` | `~/.ssh/gh_deploy` **整个文件内容** | 含 `-----BEGIN...` 和 `-----END...` 两行 |
| `SSH_PORT` | `22` | 可选 |
| `DEPLOY_PATH` | `/opt/careerai` | 可选 |
| `NOTIFY_WEBHOOK` | 企业微信群机器人 Webhook | **可选**，配了才发部署通知 |

### 第 3 步｜仓库里放 workflow

文件已生成：`.github/workflows/deploy.yml`（推送到 `main` / `dev_20261018` 或手动 Run workflow 触发）。

```bash
git add .github/workflows/deploy.yml
git commit -m "ci: 新增 GitHub Actions 自动发版"
git push origin dev_20261018
```

### 第 4 步｜确认防火墙

Actions 的运行节点 IP 是动态的，**22 端口来源必须是 `0.0.0.0/0`**（当前已是）。若你之后为了安全把 22 收窄到自家 IP，记得这条流水线会失败 —— 届时改用 Self-hosted Runner 或改回推送式白名单方案。

### 第 5 步｜验证

- GitHub → **Actions** 页看 `Deploy to Lighthouse` 运行；
- 成功标志：`Build and restart` 步骤输出健康检查 OK + 容器表，最后 Smoke test 全 200；
- 服务器上确认：`docker compose ps` 里镜像标签变成 `20261020-xxxxxxx-gh-b42` 这种形式（`gh` = GitHub 构建来源）。

> 手动只发后端：Actions → Run workflow → services 填 `server`。

---

## 三、路线 A 落地（想用 git pull 的话）

### 服务器侧一次性准备

```bash
# 1. 生成只读 Deploy Key（在服务器上生成，公钥贴到 GitHub 仓库 Settings → Deploy keys，勾选 Allow write 不勾）
ssh-keygen -t ed25519 -N "" -C "lighthouse-pull" -f ~/.ssh/github_deploy
cat ~/.ssh/github_deploy.pub     # 复制这行去 GitHub 添加 Deploy Key

# 2. 配置 SSH 走 22 端口（GitHub 23 端口常被墙，22 实测可用）
cat >> ~/.ssh/config <<'EOF'
Host github.com
  HostName github.com
  User git
  IdentityFile ~/.ssh/github_deploy
  IdentitiesOnly yes
EOF

# 3. 克隆到独立目录（不要直接覆盖 /opt/careerai 里的 .env.docker）
git clone git@github.com:fffffph/ai-job-platform.git /opt/careerai-src
```

### 服务器侧发版脚本（`/opt/scripts/pull-deploy.sh`）

```bash
#!/bin/bash
# 拉代码 → 同步到运行目录（保留生产 .env.docker）→ 构建 → 重启 → 健康检查
set -euo pipefail
cd /opt/careerai-src
git fetch --all && git reset --hard origin/dev_20261018

TAG="$(date +%Y%m%d)-$(git rev-parse --short HEAD)-srv-bpull"
rsync -a --delete \
  --exclude='.git' --exclude='node_modules' --exclude='.next' \
  --exclude='.env' --exclude='.env.docker' --exclude='deploy/*.tar.gz' \
  /opt/careerai-src/ /opt/careerai/

cd /opt/careerai
printf 'APP_TAG=%s\n' "$TAG" > .env && chmod 600 .env
docker compose build && docker compose up -d

for i in $(seq 1 40); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/api/health)" = "200" ] && { echo "OK $TAG"; exit 0; }
  sleep 3
done
echo "健康检查失败"; docker compose logs --tail=80 server; exit 1
```

手动或 cron 触发：`ssh ... '/opt/scripts/pull-deploy.sh'`。

> ⚠️ A 路线最大的坑是**网络**：`git fetch` 在国内可能几十秒到超时，建议加 `GIT_HTTP_LOW_SPEED_LIMIT` 或直接用 SSH 协议（上面已配）。不稳就回到 B。

---

## 四、路线 C 要点（后期升级）

1. Actions 里 `docker buildx build --push` 三个镜像到 `ghcr.io/fffffph/careerai-{server,web,subapp}:$TAG`；
2. 需要 `packages: write` 权限 + `GITHUB_TOKEN`；
3. 服务器 `docker compose pull && up -d`（compose 里 image 改成 `ghcr.io/...`）；
4. 服务器一次性 `docker login ghcr.io -u <user> -p <PAT>`（PAT 只给 `read:packages`）；
5. 好处：**服务器彻底不构建**，2G 内存不再被 OOM 困扰；坏处：镜像层几百 MB，首次 pull 慢。

---

## 五、必须守住的三条纪律

1. **密钥永不入库**：`.env.docker` 已在 gitignore；CI 私钥放 Secrets；服务器 Deploy Key 只读。
   检查命令：`git ls-files | grep -E '\.env$|\.env\.docker$'` 应为空。
2. **生产 `.env.docker` 只存在服务器**：任何同步/rsync 都要 `--exclude='.env.docker'`，否则线上密钥被本地值覆盖。
3. **镜像标签必须可溯源**：`日期-短哈希-来源-构建号`，回滚就是改 `APP_TAG` 再 `up -d`，不用重新构建。

---

## 六、部署前自动备份与数据回滚

### 两套备份并存（互补，不冲突）

| 备份 | 触发时机 | 文件 | 保留 |
|------|---------|------|------|
| 每日定时 | cron 每天 03:00 | `/opt/backups/careerai_YYYY-MM-DD.sql.gz` | 最近 7 份 |
| **部署前** | 每次 CD 流水线（构建之前） | `/opt/backups/predeploy_YYYYmmdd_HHMMSS.sql.gz` | 最近 10 份 |

部署前备份的价值：**它记录了"这次上线之前"的数据状态**。如果新版本跑迁移把表结构改坏了，你能精确回到上线前那一秒，而不用赌"昨天 3 点"的定时备份。

### 数据回滚三步（真出事时照着敲）

```bash
ssh -i ~/.ssh/lighthouse_careerai ubuntu@82.156.111.43
ls -lht /opt/backups/predeploy_*.sql.gz | head -5      # 挑一个时间点

# 1) 先停掉会写库的服务，避免回滚过程中有新写入
cd /opt/careerai && docker compose stop server web

# 2) 覆盖还原（--clean 先删对象再建，避免残留）
gunzip -c /opt/backups/predeploy_20261021_174332.sql.gz \
  | docker exec -i careerai-postgres psql -U postgres -d careerai

# 3) 起服务并验证
docker compose start server web
curl -s http://127.0.0.1:8080/api/health
```

> 建议**每月挑一个备份真跑一次还原**到测试库（`createdb careerai_restore` + `psql -d careerai_restore`），确认备份可用——没验证过的备份等于没有备份。

### 镜像回滚（代码层，比数据回滚更常用）

```bash
docker images | grep careerai                        # 找上一版标签
printf 'APP_TAG=上一版标签\n' > /opt/careerai/.env
cd /opt/careerai && docker compose up -d             # 秒级切回，无需重建
```

---

## 七、部署通知（企业微信机器人）

1. 企业微信群 → 右上角「…」→ **群机器人** → 添加 → 复制 Webhook 地址；
2. 仓库 Settings → Secrets → 新建 `NOTIFY_WEBHOOK`，粘贴整条 URL；
3. 之后每次部署（成功/失败/取消）都会推一条 markdown 消息，含分支、提交、镜像标签、流水线链接。

> 没配这个 Secret 也不会报错，流水线会打印"跳过通知"。另外**每次运行都会写 Actions 页面摘要**（Summary），不依赖任何配置。

---

## 八、常见问题

| 现象 | 原因 | 处理 |
|------|------|------|
| Actions 报 `Permission denied (publickey)` | 公钥没加到服务器 / Secrets 里私钥不完整 | 重加公钥；私钥必须含首尾两行 |
| `ssh: connect to host ... port 22: timed out` | 防火墙 22 限制来源 | 放行 0.0.0.0/0 或改 self-hosted |
| rsync 后 `.env.docker` 丢了 | rsync 忘了 exclude | 从备份恢复密钥文件，补 `--exclude` |
| 构建报 `ERR_PNPM_BROKEN_LOCKFILE` | lockfile 有重复键/与 package.json 不一致 | 本地重生成 lockfile，先看 CI 提示的行号 |
| 构建报 `PrismaConfigEnvError: DATABASE_URL` | CI 缺占位环境变量 | 已在 ci.yml 的 server job 配好，勿删 |
| 构建 `heap out of memory` | 2G 内存 | 只发单服务（`services=server`）或走路线 C |
| 部署成功但页面是旧版 | 浏览器缓存 / 镜像没换 | 看 `docker compose ps` 的 IMAGE 标签是否变化 |
| 流水线成功但 `/api/health` 502 | server 启动中 | 已轮询 120s；仍失败看 `docker compose logs server` |
| 部署前备份步骤报错 | postgres 容器未运行 | `docker compose ps` 确认 postgres healthy 后再重跑 |
