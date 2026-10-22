# 分支与发布工作流（main / dev / 功能分支）

> 本文把「功能开发 → 测试 → 发布生产」的完整路径固化成可执行步骤。
> 与 `docs/github-deploy-guide.md`（部署通道细节）、`docs/update-release-guide.md`（服务器侧更新/回滚）配套使用。

---

## 一、你定义的模型 & 当前 CI/CD 是否匹配

你描述的三级流：

- `main`：主分支，**生产发布分支**
- `dev`：从 `main` 拉出，**集成分支**，功能在这里汇总、测试
- `dev_20261018`（或从 `dev` 新拉的功能分支）：**功能开发分支**，做完合回 `dev`

当前流水线**已经完全匹配**这个模型，一行代码都不用改：

| 分支 | CI（`ci.yml`，只验证不部署） | CD（`deploy.yml`，真实部署） |
| --- | --- | --- |
| `dev_20261018` / `feat/*` | ✅ push 即跑 | ❌ 不触发 |
| `dev` | ✅ push / PR 即跑 | ❌ 不触发 |
| `main` | ✅ | ✅ **push 即自动部署**（前置：数据库备份 → 构建 → 重启 → 冒烟 → 通知） |
| tag `v*` | — | ✅ 自动部署 |

结论：**`main` = 发布开关**。往 `main` 合一次 = 发一次生产，其余分支随便推都不会碰生产。

---

## 二、全流程一张图

```
                 ┌──────────────────────────────────────────────┐
                 │  L1 本地验证（docker compose，主力测试环境）   │
                 └───────────────────┬──────────────────────────┘
                                     │ push
                                     ▼
   feat/xxx ──┐              ┌───────────────┐
   dev_20261018├── PR/merge ─▶│     dev       │  L2 CI 自动跑（不部署）
              ┘              └───────┬───────┘
                                     │ dev 上联调通过（可在 Actions 手跑 deploy 到生产前，
                                     │ 注意：那是真部署，不是测试）
                                     │ PR: dev → main
                                     ▼
                              ┌───────────────┐
                              │     main      │  L3 CD：备份 → 构建 → 重启 → 冒烟 → 通知
                              └───────┬───────┘
                                      ▼
                              生产 http://82.156.111.43:8080
```

方向是**单向**的：`feature → dev → main`。唯一的例外是热修（见第六节）。

---

## 三、当前分支体检报告（2026-10-22 实测）

| 分支 | HEAD | 与生产代码内容 |
| --- | --- | --- |
| `main` | `bca0828` | 一致 |
| `dev` | `8974067`（3 个 merge 提交） | 一致 |
| `dev_20261018` | `4c7d2c1` | 一致 |

**代码内容三者完全相同**（`git diff` 为空），但**历史是分叉的**：

```
main:            … f8c2986 ── 2585df9 ── bca0828   ← 老的 "Dev (#9)合并dev到main" 留下的旧历史
                                                        （bca0828 是把 dev 内容整体覆盖上来的对齐提交）
dev/dev_2026…:   … 共用 22 个提交，与 main 完全无交集
```

### 这个分叉为什么必须处理

`bca0828` 只是「内容对齐」，血缘没对齐 —— `main` 和 `dev` 的共同祖先还停在 `f8c2986`。历史分叉 + 双方都改过同一批行 = git 无从判断该取谁，于是就是 PR #18 那种「25 commits / 164 files / 一堆冲突」。

### 一次性修复：吸收式合并（✅ 已于 2026-10-22 完成）

现在三份代码内容相同，做一次 `main ← dev` 的合并：

- 树完全一样 → **零冲突**（实测：合并结果树与 `dev` 的树 SHA 完全一致）
- 代价：只多一个 merge 提交，**任何文件内容都不变**
- 收益：`main` 与 `dev` 的共同祖先立刻变成 `dev` 的最新提交 → **以后每一次 `dev → main` 都是快进（fast-forward），结构上不可能再冲突**

实际执行的命令与结果：

```bash
git checkout main && git pull --ff-only
git merge --no-edit origin/dev -m "chore: 对齐 main 与 dev 历史（内容零变化），此后 dev→main 为快进发布"
git push origin main            # bca0828..1ab106f
```

**意外的好消息：这次 push 没有触发部署。**
因为合并前后树完全相同 → GitHub 算出的变更文件数为 0 → 被 `deploy.yml` 的 `paths-ignore` 过滤掉，流水线直接跳过。
**生产零抖动**，白得一次历史对齐。

对齐后的状态（`git rev-list --left-right --count origin/main...origin/dev`）：

```
4    0        ← 左 = main 独有 4 个历史提交（旧的 Dev #9 那条线 + 本次 merge）
                右 = dev 独有 0 个  ✅ 说明 dev 已被 main 完全包含
```

这意味着：**以后 dev 上有新提交时，`git merge dev` 会是一次纯快进**，不可能再冲突。

> ⚠️ 唯一禁忌：**永远不要把 `main` 反向合进 `dev`**（`git merge main` 在 dev 上执行）。
> 那会把 4 个遗留历史提交灌进 dev，重新制造分叉。要同步就用 `git pull origin dev`。

工作分支对齐（`dev_20261018` 落后 `dev` 3 个 merge 提交、内容相同，可随时快进）：

```bash
git checkout dev_20261018 && git merge --ff-only origin/dev && git push origin dev_20261018
```

---

## 四、「测试在哪测」——你的模型里缺的一环

你的描述里 `dev` 承担「测试」，但**测试得有地方跑**。当前只有一个生产实例，所以要分三层看：

### L1 本地（主力，90% 的问题在这里拦住）

```bash
# 主应用 + 子应用
cd my-app && npm run dev          # http://localhost:3000
cd resume-optimizer && npm run dev # http://localhost:3001

# 或者整栈本地跑（更接近生产，验证 Dockerfile / nginx / 环境变量）
docker compose up -d --build      # http://localhost:8080
```

能拦住的：功能 bug、类型错误、接口联调、UI 适配、登录/权限逻辑。

### L2 CI（每次 push 自动，只验证不部署）

`ci.yml` 三个 job 并行：web(pnpm build) / server(npm ci + prisma generate + tsc) / subapp(pnpm build)。
它拦住的是「**这个分支根本构建不出来**」这类问题（lockfile 坏、依赖缺失、TS 报错）。
红灯就先修红灯，不要往下走 —— 到了服务器再炸，代价是 5 分钟构建 + 一次容器重启。

### L3 发布前（关键认知，别踩坑）

**手动跑 `Deploy to Lighthouse` 并选非 main 分支 = 直接部署到生产环境！**
它连的是同一台服务器、同一个数据库 `careerai`，还会先做一次 predeploy 备份。
这是「预发布冒烟」，不是「测试环境」。想测又不想碰线上数据 —— 只能在 L1。

### 要不要再开一套 staging？

实测数据（2026-10-22）：

```
内存 1.9G 总计 / 已用 1.2G / 可用 717M
Swap 3.9G 总计 / 已用 1.3G
磁盘 50G 总计 / 已用 30G（64%）
```

再起一套 5 容器栈（postgres + server + web + subapp + nginx）**必然 OOM**，swap 也救不回来。
**结论：现在不开 staging**。等实例升到 4G 内存、磁盘清零到 30% 以下再考虑，届时可以：
端口 `8081` + 独立目录 `/opt/careerai-staging` + 独立库名 `careerai_staging`。

---

## 五、日常操作手册（照抄即可）

### 5.1 开一个新功能

```bash
git checkout dev && git pull
git checkout -b feat/user-export      # 用 feat/ 前缀，别用日期分支
# … 开发 …
git add -A && git commit -m "feat(user): 新增用户导出"
git push -u origin feat/user-export   # CI 自动跑，不部署
```

### 5.2 合回 dev

```bash
# 方式一：本地合并（单人开发最简单）
git checkout dev && git pull
git merge --no-ff feat/user-export
git push origin dev            # 只跑 CI

# 方式二：GitHub 网页 PR（有 Code Review 记录，推荐留痕）
```

合并后立刻删掉功能分支（本地 + 远程）：

```bash
git branch -d feat/user-export
git push origin --delete feat/user-export
```

### 5.3 发布生产

```bash
# 方式一：PR（推荐，有记录，且能看到 CI 是否全绿）
#   GitHub → Pull requests → New pull request → base: main ← compare: dev → Create
#   CI 全绿 → Merge pull request

# 方式二：命令行
git checkout main && git pull
git merge --ff-only dev        # 对齐后永远是快进，不需要 --no-ff
git push origin main           # ← 这一下就是发布
```

### 5.4 用 tag 标记版本（可选但强烈建议）

```bash
git checkout main && git pull
git tag v1.3.0 -m "用户导出功能上线"
git push origin v1.3.0         # 触发一次带 tag 的部署，镜像 tag 里会带 v1.3.0
```

好处：`git tag` 列表就是一部发布史，回滚时能直接对着版本号操作。

### 5.5 回滚

**代码回滚（镜像级，30 秒）**：

```bash
# 服务器上
ssh -i ~/.ssh/lighthouse_careerai ubuntu@82.156.111.43
cd /opt/careerai
sudo docker images | grep careerai-web          # 看历史 tag
sed -i 's/^APP_TAG=.*/APP_TAG=20261022-bca0828-gh-b4/' .env
sudo docker compose up -d                        # 切回旧镜像
```

**数据回滚**：见 `docs/update-release-guide.md` 第三节（先 `stop server web`，再 `gunzip -c 备份 | psql`，再 `start`）。

### 5.6 热修（唯一允许打破「单向流」的场景）

线上炸了，`dev` 上还压着一堆没验证完的新功能 —— 不能直接发 `dev`。做法：

```bash
git checkout main && git pull
git checkout -b hotfix/otp-500
# … 修 …
git push -u origin hotfix/otp-500

# ① 先合 main 发生产
git checkout main && git merge --no-ff hotfix/otp-500 && git push origin main
# ② 再回合到 dev，避免下次发布把这个修复冲掉
git checkout dev && git merge --no-ff hotfix/otp-500 && git push origin dev
# ③ 删分支
```

**第 ② 步千万别省** —— 漏了就是「修好的 bug 在下次上线时复活」。

---

## 六、分支命名与清理纪律

### 现在的问题：日期分支变成了事实上的主干

`dev_20261018` 名字像临时分支，实际上从 10-18 用到现在，所有提交都在它上面，`dev` 反而只是它的镜像。
这会导致两个坏味道：

1. 每次「同步 dev」都要 merge 一堆 merge 提交，`git log` 变成毛线团
2. 分支名不表达「在做什么」，三个月后自己都看不懂

### 建议的命名

| 类型 | 格式 | 例子 | 生命周期 |
| --- | --- | --- | --- |
| 功能 | `feat/<短横线描述>` | `feat/user-export` | 合并后立即删 |
| 修复 | `fix/<描述>` | `fix/login-captcha` | 合并后立即删 |
| 热修 | `hotfix/<描述>` | `hotfix/otp-500` | 合并后立即删 |
| 实验 | `spike/<描述>` | `spike/rag-recall` | 随时删，不合并 |

**一条分支活过一周就是信号**：要么该合了，要么该拆了。

### 遗留分支清理（建议）

| 分支 | 状态 | 处理 |
| --- | --- | --- |
| `dev_test` | 10-15 后无提交 | ✅ 已删除（2026-10-22） |
| `dev_20261018` | 与 `dev` 内容完全一致 | 手上的活迁到 `feat/*` 后再删 |
| `dev_20226017` / `dev_new` / `dev_test_20261015` / `feature_login` | 遗留/拼写错误 | ✅ 已删除 |

当前远程只剩三个分支：`main`、`dev`、`dev_20261018`。

---

## 七、三条铁律

1. **不直接往 `main` 提交。** `main` 只接受来自 `dev`（或 `hotfix/*`）的合并。直接改 main = 绕过测试环节。
2. **push `main` 前，先想清楚「这是发布」。** 有 predeploy 备份兜底，但会重启生产容器，用户会掉线几秒到几十秒。
3. **分支只出不进。** 功能分支不要在自己的分支上去合别人的分支；要拿最新代码就 `git rebase dev` 或「合到 dev 再拉」。

---

## 八、常见问题

**Q：CI 红了但我不想修，能直接合 main 吗？**
技术上能（CD 不检查 CI 结果），但 `main` 上构建失败会让你失去「随时可发布」的能力，且下次部署必炸。CI 红就修。

**Q：`dev` 和 `dev_20261018` 该以谁为准？**
对齐之后两者内容相同，**以 `dev` 为准**。`dev_20261018` 应该被逐步淘汰。

**Q：改完 `nginx.conf` 或 `.env` 只做「重新部署」行不行？**
不行。`nginx.conf` 是单文件 bind mount，`scp` 替换会换 inode，容器仍指向旧文件。必须 `docker compose up -d --force-recreate nginx`。走 CD 流水线（`docker compose build && up -d`）会自动重建，没有这个问题。

**Q：我 push 了 `main`，为什么 Actions 里没有新运行？**
`deploy.yml` 带 `paths-ignore: ['.github/**', 'docs/**', '**.md', 'deploy/*.tar.gz']`。两种会「静默跳过」的情况：
① 这次 push 只动了文档/流水线文件；② 这次 push 的 diff 为空（比如只做历史合并、内容没变）。
判定标准是「**这次 push 到底改没改部署相关的代码**」，不是「有没有提交」。这是设计行为，不是故障。

**Q：部署失败了怎么办？**
Actions 页面看哪个 step 红。最常见两类：构建 OOM（内存不足，加 swap 或调 `NODE_OPTIONS`）、容器健康检查超时（看 `docker logs careerai-server`）。代码没换的情况下失败，可在同页面点 **Re-run failed jobs**。
