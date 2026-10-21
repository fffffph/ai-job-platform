# 生产发版操作手册（CareerAI on 腾讯云轻量）

> 服务器：`ubuntu@82.156.111.43`（北京二区，2C2G）  
> 代码目录：`/opt/careerai`　入口：`http://82.156.111.43:8080`  
> 镜像命名：`careerai-<服务>:<日期>-<git哈希>-<打包人>-b<构建号>`，由 `APP_TAG` 控制

---

## 一、日常发版：一条命令搞定（推荐）

本地改完代码后，在项目根目录的 **Git Bash** 里执行：

```bash
./deploy/push.sh
```

它会自动完成：算标签 → 打包 → 上传 → 解压 → 构建镜像 → 滚动重启 → 健康检查。

**只发某个服务**（改后端时不用重建前端，省 3 分钟）：

```bash
./deploy/push.sh server          # 只发后端
./deploy/push.sh web             # 只发主应用
./deploy/push.sh subapp          # 只发子应用
```

**手动指定标签**（热修 / 回滚）：

```bash
APP_TAG=hotfix-login-1 ./deploy/push.sh
```

---

## 二、手工发版：完全自己掌控（脚本出问题时的兜底）

### 步骤 1｜本地打包

```bash
cd /c/Users/Administrator/Desktop/frontend-restart-plan/ai-job-platform

tar -czf /tmp/careerai.tar.gz \
  --exclude=node_modules --exclude=.next --exclude=.git \
  --exclude=.workbuddy --exclude=dist --exclude='*.log' \
  --exclude=.env --exclude=.env.docker \
  my-app resume-optimizer docker-compose.yml nginx.conf proxy_headers.conf deploy
```

> ⚠️ **必须排除 `.env.docker`**：生产密钥只认服务器上那份，本地覆盖会把线上配置冲掉。  
> ⚠️ 排除了 `node_modules`，包只有 4MB 左右；别图省事把依赖打进去（几百 MB 且会覆盖服务器缓存）。

### 步骤 2｜上传

```bash
scp -i ~/.ssh/lighthouse_careerai /tmp/careerai.tar.gz ubuntu@82.156.111.43:/tmp/
```

### 步骤 3｜服务器解压

```bash
ssh -i ~/.ssh/lighthouse_careerai ubuntu@82.156.111.43
cd /opt/careerai
tar -xzf /tmp/careerai.tar.gz -C /opt/careerai
rm -f /tmp/careerai.tar.gz
```

### 步骤 4｜构建镜像（带溯源标签）

```bash
cd /opt/careerai

# 标签规则：日期-git短哈希-打包人-b构建号
export APP_TAG="$(date +%Y%m%d)-$(git rev-parse --short HEAD 2>/dev/null || echo nogit)-fph-bmanual"
echo "本次标签: $APP_TAG"

# 建议先写入 .env，后续手敲 compose 命令就不用每次带变量
printf 'APP_TAG=%s\n' "$APP_TAG" > .env && chmod 600 .env

docker compose build            # 全量
docker compose build server     # 只构建后端
```

> 2G 内存注意：**不要三个服务并发构建**。分开构建或直接单服务构建，OOM 会在日志里显示 `JavaScript heap out of memory`。

### 步骤 5｜滚动重启

```bash
docker compose up -d
docker compose ps --format 'table {{.Name}}\t{{.Image}}\t{{.Status}}'
```

### 步骤 6｜冒烟验证

```bash
for p in /api/health / /login /resume-optimizer/ /api/menu/my; do
  printf '%-20s ' "$p"; curl -s -o /dev/null -w 'HTTP %{http_code}\n' "http://127.0.0.1:8080$p"
done
docker compose logs --tail=50 server
```

**期望值**：`/api/health` 200、`/` 200、`/login` 200、`/resume-optimizer/` 200、`/api/menu/my` 401（未登录的正确表现）。

---

## 三、回滚：镜像标签就是回滚点

```bash
ssh -i ~/.ssh/lighthouse_careerai ubuntu@82.156.111.43
cd /opt/careerai
docker images | grep careerai          # 看历史标签

# 回到上一版（把标签换成目标版本）
printf 'APP_TAG=20261018-d251de5-admi-bmanual\n' > .env
docker compose up -d                   # 秒级切回，无需重新构建
```

> 所以**不要随手 `docker image prune -a`**，至少保留最近 3 个版本用于回滚。

---

## 四、状态码对照（自查用）

| 现象                             | 含义                   | 处理                                                                                                       |
| ------------------------------ | -------------------- | -------------------------------------------------------------------------------------------------------- |
| `/api/health` 502              | server 容器挂了          | `docker compose logs server`                                                                             |
| `/api/health` 200 但页面白屏        | web 构建产物问题           | 看浏览器 Network，重建 web                                                                                      |
| `/api/menu/my` 返回 200 HTML     | nginx 把 API 转给了 Next | 检查 `nginx.conf` 的 `location /api/`                                                                       |
| 容器 `Restarting`                | 启动脚本失败               | 常见：数据库未连上 / pgvector 扩展缺失                                                                                |
| `type "vector" does not exist` | 新库无 pgvector 扩展      | `docker exec careerai-postgres psql -U postgres -d careerai -c 'CREATE EXTENSION IF NOT EXISTS vector;'` |
| 构建 `heap out of memory`        | 内存不足                 | 分开构建 / 确认 swap 在                                                                                         |

---

## 五、配置文件改动后的特殊处理

| 改了啥                                 | 需要做什么                                                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 源码（tsx/ts）                          | 重建对应镜像 + `up -d`                                                                                             |
| `nginx.conf` / `proxy_headers.conf` | **必须 `docker compose up -d --force-recreate nginx`**（单文件 bind mount，scp 覆盖会换 inode，`nginx -s reload` 读不到新内容） |
| `docker-compose.yml`                | `docker compose up -d`（compose 会自动识别变更并重建）                                                                   |
| `.env.docker`（密钥/数据库口令）             | `docker compose up -d --force-recreate server`（env 只在容器创建时注入）                                                |
| 数据库结构（schema.prisma）                | 不用手动迁移，server 启动时自动 `prisma db push`                                                                         |

---

## 六、新服务器从零搭建（灾难恢复用）

```bash
# 1. 装 Docker（get.docker.com 国内被墙，走阿里源）
curl -fsSL https://mirrors.aliyun.com/docker-ce/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://mirrors.aliyun.com/docker-ce/linux/ubuntu noble stable" | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt-get update && sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker && sudo usermod -aG docker $USER

# 2. 加 swap（2G 机器构建必备）
sudo fallocate -l 2G /swapfile2 && sudo chmod 600 /swapfile2 && sudo mkswap /swapfile2 && sudo swapon /swapfile2
echo '/swapfile2 none swap sw 0 0' | sudo tee -a /etc/fstab

# 3. 放代码 + 恢复数据
sudo mkdir -p /opt/careerai && sudo chown $USER:$USER /opt/careerai
# 上传部署包解压（含 .env.docker）
gunzip -c careerai_YYYY-MM-DD.sql.gz | docker exec -i careerai-postgres psql -U postgres -d careerai
docker exec careerai-postgres psql -U postgres -d careerai -c 'CREATE EXTENSION IF NOT EXISTS vector;'

# 4. 构建启动
cd /opt/careerai && ./deploy/build.sh    # 或按第二节步骤 4-6
```

> ⚠️ `deploy/build.sh` 依赖 `git rev-parse` 生成标签。服务器 `/opt/careerai` 是解压出来的目录、**不是 git 仓库**，  
> 在服务器上直接跑会报错。服务器端请用「手工指定 APP_TAG」的方式（第二节步骤 4），  
> 或先 `git init && git add -A && git commit -m init` 把目录变成仓库。  
> 日常发版推荐在**本地**跑 `deploy/push.sh`，标签由本地 git 生成、带到服务器，天然可溯源。
