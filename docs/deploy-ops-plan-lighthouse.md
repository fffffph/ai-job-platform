# CareerAI 腾讯云轻量应用服务器 生产部署与运维方案

> 状态：**已确认（2026-10-17），执行路线 A —— 未备案期间以 IP:8080 上线，P5/P6 顺延**
> 目标实例：Hermes-Agent-UZOP（lhins，北京二区，2核 2G / 50G SSD，IP 82.156.111.43，到期 2026-11-17）
> 操作系统：**Ubuntu Server 24.04 LTS**（Hermes Agent 应用镜像底层，标准系统，无需重装）
> 项目形态：Docker 5 容器（postgres / server / web / subapp / nginx），nginx 为唯一入口，当前映射 `8080:80`

### 2026-10-17 确认结论
| 事项 | 结论 |
|------|------|
| 操作系统 | Ubuntu 24.04 LTS（应用镜像底层），**不重装** |
| 域名 / ICP 备案 | 均未办理 → 先走 **路线 A（IP:8080）**，备案下来后切域名 + HTTPS |
| HTTPS 证书 | 腾讯云免费 DV 证书（3 个月有效期手动续期） |
| 代码上机 | 先本地打包上传（部署包已就绪：`deploy/careerai-deploy-20261017.tar.gz`，3.8MB，382 文件），后期切 Git |

---

## 一、总体架构

```
用户浏览器
   │  https://careerai.example.com (443, HTTP→HTTPS 301)
   ▼
腾讯云防火墙（Lighthouse 防火墙，不是 CVM 安全组）
   │  放行 80 / 443 / 22
   ▼
宿主机 Nginx（SSL 卸载 + 反向代理）        ← 方案A（推荐）
   │  http://127.0.0.1:8080
   ▼
Docker 网络 app-net（容器间仅内网互通）
   ├─ nginx 容器   :80   → web / server / subapp 按路径分发
   ├─ web 容器     :3000  Next.js 主应用
   ├─ server 容器  :4000  Express API
   ├─ subapp 容器  :80    子应用 UMD 静态资源
   └─ postgres     :5432  仅容器内网，绝不对外
```

**关键设计决策**：HTTPS 证书与 80/443 由**宿主机 Nginx** 承接（方案 A），Docker 内的 nginx 容器保持 8080 不动。
优点：容器编排零改动；证书续期只换宿主机文件 + reload，不重建容器；60 天一次的免费证书续期最省事。

---

## 二、分阶段执行清单（共 7 阶段）

| 阶段 | 内容 | 风险 | 前置条件 |
|:---:|------|:---:|---------|
| P1 | 服务器初始化（系统、swap、Docker） | 🟢 | 实例已运行 |
| P2 | 项目代码与生产环境变量上机 | 🟢 | P1 |
| P3 | 构建启动 + 内部自测（IP:8080） | 🟡 | P2 |
| P4 | 防火墙端口开放 | 🟡 | P3 |
| P5 | 域名解析 + ICP 备案 | 🟢 | 已购域名 |
| P6 | HTTPS 证书 + 宿主机 Nginx | 🟡 | P4、P5 |
| P7 | 日志 / 监控 / 备份 / 告警 | 🟢 | P3 |

> ⚠️ **备案是境内硬约束**：实例在北京（境内地域），绑定域名走 80/443 对外提供网站服务**必须完成 ICP 备案**。备案期间（通常 7~20 天）可先用 `http://82.156.111.43:8080` 访问自测，备案下来后再切域名 + HTTPS。

---

## 三、各阶段详细方案

### P1 服务器初始化

**目标**：把一台裸机变成能跑 Docker 的生产机。

关键点：
1. **确认操作系统**：截图显示实例可能用了 Agent 类应用镜像。若非标准系统，建议重装为 **Ubuntu Server 22.04 LTS** 或 Debian 12（重装会清盘，先确认无重要数据）。重装入口：控制台 → 重置应用/重装系统。
2. **2G 内存必须加 swap**：5 容器 + 构建期 npm/prisma generate 很容易 OOM，无 swap 时构建会被内核杀掉（表现为 `Killed`）。
   ```bash
   # 创建 2G swap（一次性，重启后仍生效需写入 fstab）
   fallocate -l 2G /swapfile && chmod 600 /swapfile
   mkswap /swapfile && swapon /swapfile
   echo '/swapfile none swap sw 0 0' >> /etc/fstab
   # 降低 swap 使用倾向，生产机保留在 10
   sysctl vm.swappiness=10
   ```
3. **安装 Docker + Compose 插件**（推荐腾讯云镜像源加速）：
   ```bash
   curl -fsSL https://get.docker.com | bash -s docker --mirror Aliyun
   systemctl enable --now docker
   docker compose version   # 验证
   ```
4. **配置 Docker 镜像加速 + 日志轮转**（写 `/etc/docker/daemon.json`，日志轮转见 P7）。
5. **SSH 安全**：`passwd` 改强密码或改用 SSH 密钥（控制台「SSH 密钥」绑定）；建议后续把防火墙 22 端口来源收窄到自家出口 IP。

---

### P2 代码与生产环境变量上机

**目标**：代码 + 密钥安全落到服务器。

1. **代码传输**（二选一）：
   - Git 拉取（推荐，后续更新 `git pull && docker compose up -d --build` 即完成发版）；
   - 或本地 `git archive | ssh` 打包上传（适合私有仓库不便放服务器凭证的情况）。
2. **`.env.docker` 生产化要点（最重要的一步）**：
   - `POSTGRES_PASSWORD`：**绝不用** postgres:postgres，改为强随机串，并同步改 `docker-compose.yml` 中 `DATABASE_URL`（建议把 DATABASE_URL 也挪进 env_file 引用变量，避免两处维护）；
   - `DEEPSEEK_API_KEY`：生产专用 Key，控制余额告警；
   - JWT/session 密钥：换生产独立值；
   - `NEXT_PUBLIC_API_URL` 保持空串（同源走 nginx），如改动需**重新 build** 才生效（build 时硬编码进浏览器产物）。
3. **文件权限**：`chmod 600 .env.docker`，`.env*` 必须在 `.gitignore` 中，严禁提交仓库。

---

### P3 构建启动与自测

**目标**：先在 `http://82.156.111.43:8080` 打通全链路。

```bash
cd /opt/careerai                       # 建议固定部署目录
docker compose up -d --build
docker compose ps                      # 5 个容器应全部 Up (healthy)
curl http://127.0.0.1:8080/api/health  # 期望 200
```

**2G 机器构建技巧**：先构建会占内存较多，若构建被杀，可分步 `docker compose build server && docker compose build web && docker compose build subapp`，或临时 `docker compose stop` 已跑容器再构建。

自测清单（对应项目路由）：
- [ ] `http://IP:8080` 打开主应用
- [ ] `/dashboard/resume` 子应用 qiankun 加载正常（检查 `console` 无 mixed content）
- [ ] 注册/登录 → 上传简历（≥10MB 文件验证 nginx `client_max_body_size 20m` 生效）→ AI 优化（验证 120s 代理超时）
- [ ] `/api/health` 返回正常

---

### P4 防火墙端口开放（Lighthouse 防火墙）

**目标**：只暴露必须端口。注意：**轻量服务器用的是「防火墙」页签，不是 CVM 的安全组**，两者不通用。

| 端口 | 协议 | 来源 | 用途 | 建议 |
|:---:|:---:|------|------|------|
| 22 | TCP | 我的 IP（或 0.0.0.0/0） | SSH | 能收窄就收窄 |
| 80 | TCP | 0.0.0.0/0 | HTTP（301 跳 HTTPS / 备案核验） | 备案后开 |
| 443 | TCP | 0.0.0.0/0 | HTTPS | 备案后开 |
| 8080 | TCP | 0.0.0.0/0 | 未备案期间临时访问 | **备案下来后删除此规则** |

PostgreSQL 5432、server 4000、web 3000 一律**不开**——它们只在 Docker 内网互通，这是 compose 架构已保证的。

---

### P5 域名解析与 ICP 备案

**目标**：域名指向 82.156.111.43，并满足境内合规。

1. 域名在腾讯云控制台「域名注册」购买/管理 → 「解析」添加 **A 记录**：`@` 和 `www` → `82.156.111.43`，TTL 600s。
2. **ICP 备案**：控制台「网站备案」提交（服务器需满足购买时长要求，轻量实例符合）。期间网站需处于可访问状态配合管局核验。
3. 备案通过后，将备案号放在站点页脚（管局要求）。
4. 可选：开启腾讯云 DNSPod 的「免费 HTTPS/CDN 加速」前先明确与自建 nginx 的职责边界，本项目推荐**证书与 HTTPS 都收在服务器本地**，链路简单可控。

**注意**：解析生效（`ping` 域名通）≠ 可以走 80/443 对外提供服务，未备案时运营商会在 80/443 上拦截。

---

### P6 HTTPS 证书与宿主机 Nginx（方案 A）

**目标**：HTTPS 全站加密 + HTTP 自动跳转 + HTTP/2。

**证书获取（二选一）**：
- **腾讯云免费 DV 证书**（TrustAsia，3 个月有效期，可重复免费申请）：SSL 证书控制台 → 申请免费证书 → 域名验证（DNS 自动）→ 签发后下载 **Nginx 格式**（`.pem` + `.key`）→ 上传到 `/etc/nginx/ssl/`。缺点：需每 3 个月手动换一次。
- **acme.sh + Let's Encrypt**（推荐，自动续期）：
  ```bash
  curl https://get.acme.sh | sh -s email=you@example.com
  acme.sh --issue -d careerai.example.com --webroot /var/www/html
  acme.sh --install-cert -d careerai.example.com \
    --key-file /etc/nginx/ssl/careerai.key \
    --fullchain-file /etc/nginx/ssl/careerai.pem \
    --reloadcmd "nginx -s reload"
  ```
  注意：acme.sh 自动续期要求 80 端口可达（HTTP-01 验证），宿主机 nginx 需放行 `.well-known` 路径。

**宿主机 Nginx 配置**（`/etc/nginx/conf.d/careerai.conf`）：

```nginx
# HTTP → HTTPS 强制跳转；同时给 acme 续期留出验证路径
server {
    listen 80;
    server_name careerai.example.com;
    location /.well-known/acme-challenge/ { root /var/www/html; }
    location / { return 301 https://$host$request_uri; }
}

server {
    listen 443 ssl http2;
    server_name careerai.example.com;

    ssl_certificate     /etc/nginx/ssl/careerai.pem;
    ssl_certificate_key /etc/nginx/ssl/careerai.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # 简历上传 10MB：宿主机这层同样要放开，两层 nginx 各自有限制
    client_max_body_size 20m;
    proxy_connect_timeout 10s;
    proxy_send_timeout    120s;
    proxy_read_timeout    120s;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

**⚠️ SSE 流式输出的专项注意**：项目已升级 LangChain/LangGraph + SSE。SSE 经两层 nginx 代理极易被缓冲导致前端"转圈很久一次性蹦出"或超时。需在转发 `/api/resume/`（或实际 SSE 接口）的 location 中加：

```nginx
proxy_buffering off;        # 关键：关闭响应缓冲
proxy_cache off;
proxy_set_header Connection '';
proxy_http_version 1.1;
```

容器内 `nginx.conf` 若 SSE 接口也走 `/api/resume/`，同样补这段。

**最后**：删除防火墙 8080 公网规则，入口收敛为 443 一条。HTTPS 上线后可用 `https://myssl.com/你的域名` 体检。

---

### P7 进程守护、开机自启、日志、监控、备份

**进程守护与自启**（三层保障，均已覆盖）：
1. compose 内所有服务已是 `restart: unless-stopped`（容器崩溃自动拉起）；
2. `systemctl enable docker`（服务器重启后 Docker 守护进程自启）；
3. 容器随 dockerd 自动恢复。
验证：`sudo reboot` 后 `docker compose ps` 应全部自动 Up。

**日志**：
- Docker 默认 json-file 日志会无限增长（50G 盘很快被吃满），`/etc/docker/daemon.json` 加轮转：
  ```json
  { "log-driver": "json-file", "log-opts": { "max-size": "20m", "max-file": "3" } }
  ```
  改完需 `systemctl restart docker`（容器会重启一次，挑低峰）。
- 排查三板斧：`docker compose logs -f --tail=200 server`、`docker compose ps`、`docker stats`。
- 宿主机 nginx 访问日志在 `/var/log/nginx/`，logrotate 系统自带。

**监控与告警**（2G 小水管必须配）：
- Lighthouse 控制台「监控」页看 CPU / 内存 / 带宽 / 流量包（本月余量，300G 套餐流量超了会限速或计费）；
- 控制台「告警」配三条：CPU > 80% 持续 5 分钟、内存 > 85%、磁盘 > 90%；
- 应用层心跳：外部拨测 `GET /api/health`（可用腾讯云拨测或 UptimeRobot 免费版）。

**备份与数据安全**：
| 对象 | 方式 | 频率 | 恢复目标 |
|------|------|:---:|---------|
| PostgreSQL（用户/简历数据） | `pg_dump` 脚本 + cron，落地 `/opt/backups/` | 每日 03:00 | 误删/误操作 |
| 整机磁盘 | 控制台「云硬盘备份」创建**快照** | 每周 1 次 | 系统盘损坏/被黑 |
| 配置与代码 | Git 仓库 + `.env.docker` 异地留存一份（密码管理器） | 每次变更 | 重建环境 |

每日备份脚本（cron 执行，保留 7 份）：
```bash
#!/bin/bash
# /opt/scripts/backup-db.sh —— 每日数据库备份，保留最近 7 份
BACKUP_DIR=/opt/backups
docker exec careerai-postgres pg_dump -U postgres careerai | gzip > \
  $BACKUP_DIR/careerai_$(date +%F).sql.gz
ls -1t $BACKUP_DIR/careerai_*.sql.gz | tail -n +8 | xargs -r rm
```
配合 crontab：`0 3 * * * /opt/scripts/backup-db.sh`。
恢复演练一次（`gunzip -c xx.sql.gz | docker exec -i careerai-postgres psql -U postgres careerai`），没演练过的备份等于没有备份。

---

## 四、常见故障排查速查表

| 现象 | 排查顺序 | 高频根因 |
|------|---------|---------|
| 502 Bad Gateway | `docker compose ps` → 容器是否 Up | server 容器连不上 postgres（健康检查未过/密码不符） |
| 上传简历 413 | 看 nginx 日志 | `client_max_body_size` 只在一层放开 |
| AI 优化 60s 后断开 | `proxy_read_timeout` | 两层 nginx 都要 120s；SSE 加 `proxy_buffering off` |
| 构建中途 `Killed` | `free -h` | 2G 内存耗尽 → 加 swap / 分步构建 |
| 机器越来越卡 | `docker stats`、`df -h` | 容器日志未轮转 / 磁盘满 |
| 域名 80/443 打不开但 IP:8080 可以 | 备案状态查询 | 境内未备案被运营商拦截 |
| 重启后服务没起来 | `systemctl status docker` | docker 未 enable / 容器未 restart 策略 |
| 证书过期 | `openssl s_client -connect 域名:443` | 免费证书 3 个月未换 → 换 acme.sh 自动续期 |

---

## 五、实施记录（2026-10-17 实际执行）

### P1 服务器初始化 ✅
- 通过 SSH 密钥免密登录（`ubuntu@82.156.111.43`，私钥 `~/.ssh/lighthouse_careerai`）
- `get.docker.com` **被墙**（connection reset）→ 改用**阿里云 docker-ce 源**安装成功
- 版本：Docker **29.9.1** + Compose **v5.6.0**，`systemctl enable --now docker` 已生效
- `/etc/docker/daemon.json`：腾讯云内网镜像加速 + json-file 日志轮转（20m × 3）
- swap：系统自带 1.9G，另新增 `/swapfile2` 2G → 合计 **3.9G**（构建期 OOM 兜底）

### P2 代码上机 ✅
- 部署包 `deploy/careerai-deploy-20261017.tar.gz`（3.8MB）→ 解压到 `/opt/careerai`
- `.env.docker` 权限 `600`，已删除 `my-app/.env.local`

### P3 构建与启动 ✅（修复 3 个构建期问题）
| 问题 | 现象 | 修复 |
|------|------|------|
| `pnpm@11` 不存在 | corepack 报 fetch 失败 / 404 | 改为 `npm i -g pnpm@10 --registry=https://registry.npmmirror.com`（lockfile 9.0 与 pnpm 10 匹配） |
| npm/pnpm 走官方源太慢 | 安装超时 | 所有安装命令追加 `--registry=https://registry.npmmirror.com` |
| `pnpm-workspace.yaml` 含非法 `allowBuilds` 占位文本 | pnpm 解析异常风险 | 删除该段，仅保留 `onlyBuiltDependencies` |
| 构建 OOM（`JavaScript heap out of memory`） | Vite/Next 构建被杀 | swap 加到 4G + `NODE_OPTIONS=--max-old-space-size=1536` |

镜像产物：`careerai-web 306MB` / `careerai-server 965MB` / `careerai-subapp 120MB`

### 运行期问题修复
- **server 反复重启**：`prisma db push` 报 `type "vector" does not exist`
  → `docker exec careerai-postgres psql -U postgres -d careerai -c 'CREATE EXTENSION IF NOT EXISTS vector;'`
  说明：compose 用的是 `pgvector/pgvector:pg16` 镜像，扩展文件已内置，但**新库需要手动 CREATE EXTENSION**。
  ⚠️ 换新库/清库后必须重跑这条，否则 server 起不来。
- **部署包版本落后（重要教训）**：包是 17:39 打的，但 nginx.conf（19:59）、server/Dockerfile + seed-roles-docker.mjs（19:54）之后又改过，
  上机后仍是「旧版逐前缀转发 + 无菜单种子」→ 侧边栏菜单 404。
  修复：同步这 3 个文件 → 重建 server 镜像 → `up -d --force-recreate server nginx`。
  验收：`menus=24`、`/api/menu/my` → **401 JSON**（Express 正确接管）、`/api/chat` → 405（Next 自有 API，仅 POST）。
  **发版纪律：打包前先确认最近改动时间，或每次发版都重新打包 + 全量重建。**
- **nginx 配置改动后必须重建容器**：`nginx.conf` 是单文件 bind mount，`scp` 覆盖会换 inode，
  `nginx -s reload` 可能读不到新内容 → 用 `docker compose up -d --force-recreate nginx`。

### 验收结果
| 检查项 | 结果 |
|--------|------|
| `curl 127.0.0.1:8080/api/health` | ✅ 200 `{"success":true,...}` |
| 首页 `/` | ✅ 200 |
| 登录页 `/login` | ✅ 200 |
| 子应用 `/resume-optimizer/` | ✅ 200 |
| 数据库表 | ✅ 13 张表已建 |
| 容器状态 | ✅ 5/5 Up（postgres healthy） |
| 重启策略 | ✅ 全部 `unless-stopped` + docker `enabled` |
| 内存占用 | ✅ 总计约 190MB / 1.9G |

### P7 备份 ✅
- `/opt/scripts/backup-db.sh`：`pg_dump | gzip` 到 `/opt/backups/`，保留 7 份
- crontab：`0 3 * * *`（每日 03:00），已手动跑通一次（2.6KB dump）

### 待办
1. ✅ **防火墙放行 8080**（2026-10-17 21:09 已加规则）→ 公网冒烟全通过：
   `/api/health` 200（58ms）、`/` 200、`/login` 200、`/register` 200、
   `/resume-optimizer/` 200、`/api/menu/my` 401 JSON（Express 正确接管）、`/api/chat` 405（Next 仅 POST，正确）
   **公网入口：http://82.156.111.43:8080**
2. 🟡 备份恢复演练（`gunzip -c xx.sql.gz | docker exec -i careerai-postgres psql -U postgres careerai`）
3. 🟡 快照策略（控制台每周 1 次）
4. 🟡 监控告警（CPU/内存/磁盘/流量包）
5. ⏳ 域名 + 备案后：P5 解析 → P6 HTTPS（届时需处理自带的 **Caddy 占用 80/443**）

---

## 六、确认结论（2026-10-17）

1. ✅ **操作系统**：Ubuntu Server 24.04 LTS（应用镜像底层），标准系统，**不重装**，直接进入 P1。
2. ✅ **域名**：未购买 → P5 顺延，先用 IP:8080 访问。
3. ✅ **备案**：未办理 → 80/443 暂不开通，防火墙只放 22 + 8080；备案下来后按 P5/P6 补齐。
4. ✅ **HTTPS 方案**：腾讯云免费 DV 证书（3 个月手动续期；如嫌麻烦可随时切 acme.sh 自动续期）。
5. ✅ **代码上机方式**：先本地打包上传（`deploy/careerai-deploy-20261017.tar.gz` 已生成），后期切 Git。

### 执行路线 A（当前生效）
```
P1 服务器初始化（swap + Docker）→ P2 上传部署包解压 → P3 构建启动
→ P4 防火墙放行 8080 → 自测 http://82.156.111.43:8080
（待域名购买 + 备案通过后）→ P5 域名解析 → P6 HTTPS 切换 → 收口删 8080 规则
```

### 上机前注意
- 包内含 `.env.docker`（数据库密码 / DEEPSEEK_API_KEY / JWT 密钥），上传后务必 `chmod 600`；确认其中密码是否已换成强随机值后再启动。
- 包内同时含 `my-app/.env.local`（开发环境变量），服务器上不会生效（compose 只读 `.env.docker`），但建议上机后删除避免混淆。
