# 登录方式扩展 + 用户管理「新增用户」设计方案

> 状态：**A-P0 + B-P0 已实施并自测通过**（详见「九、实施状态」）
> 适用范围：`my-app`（Next.js 主应用）+ `my-app/server`（Express API）
> 编写日期：2026-10-14

---

## 一、现状盘点

先把地基看清楚，避免设计与现有架构打架。

| 能力 | 现状实现 | 位置 |
|---|---|---|
| 注册 | 邮箱 + 密码 + 用户名（**实际写入 `User.name` 昵称**） | `app/register/page.tsx` → `POST /api/auth/register` |
| 登录 | 邮箱 + 密码 | `app/login/page.tsx` → `POST /api/auth/login` |
| 密码存储 | bcrypt，盐轮数 10（`BCRYPT_SALT_ROUNDS`） | `server/src/services/auth.service.ts` |
| 会话 | JWT（HS256，过期 7 天，issuer `careerai-api`） | `generateToken()` |
| 鉴权 | Bearer Token + **每个请求实时查库校验 status** | `server/src/middleware/auth.ts` |
| 权限 | RBAC：`roles` / `user_roles` / `menus` / `role_menus` | `server/src/middleware/rbac.ts` |
| 用户管理 | 列表 / 搜索 / 分页 / 分配角色 / 停用启用 | `app/dashboard/system/user/page.tsx` |
| 用户管理权限码 | `system:user`、`system:user:grant`、`system:user:disable` | `lib/permissions.ts` ⇄ `middleware/rbac.ts` |
| 系统配置 | 注册表 `CONFIG_SCHEMA` + 覆盖值表 `system_configs`（schema 驱动前端表单） | `server/src/config/schema.ts` |

### 三个必须知道的现状问题

1. **注册页的「用户名」不是登录标识**
   `app/register/page.tsx` 中 `name="username"` 的表单字段，提交时映射为 `name: values.username`，落库到 `User.name`（昵称）。所以现在**根本没有账号/用户名登录**，只有邮箱登录。

2. **改密码后旧 Token 依然有效**
   `authMiddleware` 只校验 `status`，不校验密码是否已变更。管理员重置密码、用户自己改密码后，攻击者手里的旧 Token 在 7 天内仍然可用。要补 `tokenVersion`。

3. **登录页「忘记密码？」是死链**
   `app/login/page.tsx` 里 `<a href="#">忘记密码？</a>`，需要配合验证码能力一起补上。

---

## 二、登录方式选型

### 2.1 全量方案对比

| # | 方式 | 用户门槛 | 外部依赖 / 资质 | 直接成本 | 开发量 | 备注 |
|---|---|---|---|---|---|---|
| A | 邮箱 + 密码 | 低 | 无 | 0 | — | **现有能力，保留** |
| B | 用户名 / 账号 + 密码 | 低 | 无 | 0 | 小 | 国内用户最习惯的叫法，**必做** |
| C | 手机号 + 密码 | 低 | 无 | 0 | 小 | 复用同一套密码链路 |
| D | **邮箱验证码登录（OTP 免密）** | 极低 | SMTP / 邮件推送（免资质） | ≈0 | 中 | **零资质门槛，优先做** |
| E | 手机号 + 短信验证码 | 极低 | 短信服务商 + **签名/模板需企业资质审核** | ~0.04 元/条 | 中 | 体验最好，但排期有外部不确定项 |
| F | GitHub OAuth | 低 | 免费建 OAuth App | 0 | 中 | **技术岗求职者高度契合**，零资质零成本 |
| G | 微信扫码 / 公众号登录 | 最低 | 需企业主体 + 开放平台认证（300 元/年） | 0 | 大 | 个人主体走不通 |
| H | Passkey / WebAuthn | 中 | 无 | 0 | 大 | 前瞻项，可作技术亮点 |
| I | 一键登录（运营商） | 最低 | 运营商 SDK + 商务合作 | 按次计费 | 大 | **不建议**，成本与接入门槛都不匹配 |
| J | 企业微信 / 钉钉扫码 | 低 | 需企业主体 | 0 | 中 | 仅 B 端场景才考虑 |

### 2.2 对本项目的推荐结论

```
P0  必做（无外部依赖）
    ├─ B  统一登录入口：邮箱 / 手机号 / 用户名 三选一，智能识别
    └─ C  手机号 + 密码（密码链路已就绪，只差字段）

P1  强烈推荐（成本极低、演示价值高）
    ├─ D  邮箱验证码登录 + 忘记密码     ← 零资质，能立刻跑通完整闭环
    └─ E  手机号短信验证码登录           ← 代码同步写好，等短信资质到位即可上线

P2  加分项（求职作品集的差异化亮点）
    └─ F  GitHub 扫码登录（免费、5 分钟建 App、与「前端/AI 求职平台」定位天然契合）

P3  暂不做
    ├─ G  微信扫码（个人主体无资质）
    ├─ H  Passkey（可作为后续技术演进方向写进 README）
    └─ I  运营商一键登录
```

**关键排期建议**：短信签名/模板审核通常要 1–3 个工作日，且需要企业营业执照。**先把邮箱验证码做完**（立即可用、可演示），短信通道代码同步实现但用 Mock Provider 兜底，等资质下来只切一个环境变量。这样不会被外部审核卡住进度。

---

## 三、核心设计：统一账号模型

### 3.1 User 表扩展

```prisma
model User {
  id       String  @id @default(uuid()) @map("id")
  email    String? @unique @map("email")     // ← 改可空
  phone    String? @unique @map("phone")     // ← 新增
  username String? @unique @map("username")  // ← 新增（真正的登录账号）
  password String? @map("password")          // ← 改可空（验证码/OAuth 用户无密码）

  name     String? @map("name")              // 昵称，仅展示用
  // ... avatar / bio / status / deepseekKey* 等保持不变

  /** 首次登录是否强制修改密码（管理员代建账号时为 true） */
  mustChangePassword Boolean  @default(false) @map("must_change_password")
  /** Token 版本号：改密码/重置/强制下线时 +1，旧 Token 立即失效 */
  tokenVersion       Int      @default(0)     @map("token_version")
  /** 最后登录时间 / IP / 方式（登录日志的轻量版） */
  lastLoginAt        DateTime? @map("last_login_at")
  lastLoginIp        String?   @map("last_login_ip")
  lastLoginMethod    String?   @map("last_login_method")
  /** 软删除标记（见 5.6 风险点） */
  deletedAt          DateTime? @map("deleted_at")
}
```

**为什么三个标识都能「唯一且可空」？**
PostgreSQL（以及 MySQL）的唯一索引对 `NULL` 不生效——多行 `NULL` 不互相冲突。所以 `email` / `phone` / `username` 可以同时加 `@unique`，又允许为空，**不需要用空字符串或占位符凑数**。这是这个方案能优雅落地的前提。

**约束由应用层保证**：三个标识至少要有一个非空。在注册 / 新增用户 / 绑定标识三处统一调用同一个校验函数（`assertHasLoginIdentity`），不要散落判断。

### 3.2 新增数据表

```
verification_codes   验证码
  id / target / channel(email|sms) / scene(login|register|reset_password|bind_phone|bind_email)
  code_hash / expires_at / attempts / max_attempts / consumed_at / request_ip / created_at
  @@index([target, scene, created_at])

user_identities      第三方账号绑定
  id / user_id / provider(github|wechat) / provider_user_id / nickname / avatar / created_at
  @@unique([provider, provider_user_id])   @@index([user_id])

login_logs           登录日志（审计 + 安全风控）
  id / user_id? / identifier / method(password|email_otp|sms_otp|oauth)
  success / fail_reason / ip / user_agent / created_at
  @@index([user_id, created_at])
```

`verification_codes` 用**独立表**而不是 Redis，理由是：项目当前部署栈（5 容器：web / server / subapp / postgres / nginx）没有 Redis，为了验证码多起一个容器不划算；PostgreSQL 扛这个量级绰绰有余，还能顺便获得审计能力。将来并发上来了再换 Redis，接口层不用改。

---

## 四、登录页与登录链路设计

### 4.1 统一登录入口（一个输入框）

登录方式可以多，但**入口只留一个**——用户不需要先想「我该点哪个 Tab」。

**标识识别规则**（前端做即时提示、后端做权威判定，共用同一份正则）：

| 输入特征 | 判定类型 | 前端表现 |
|---|---|---|
| 含 `@` | `email` | 输入框前缀切为信封图标，提示「邮箱登录」 |
| 匹配 `^1[3-9]\d{9}$` | `phone` | 前缀切为手机图标，提示「手机号登录」 |
| 匹配 `^[a-zA-Z0-9_-]{3,20}$` | `username` | 前缀切为用户图标，提示「账号登录」 |
| 其他 | 无效 | 实时红字提示格式 |

后端 `resolveIdentifier(input)` 返回 `{ field, value }`，然后用 `prisma.user.findFirst({ where: { [field]: value } })` 定位用户。**只按判定出的单一字段查询，不做 OR 模糊匹配**——OR 匹配会在「用户名恰好等于他人手机号」时产生歧义用户。

### 4.2 登录页 Tab 结构

保留现有黑色科技风视觉（`darkAlgorithm` + `bg-[#050505]`），只替换表单区域：

| Tab | 内容 | 控制开关 |
|---|---|---|
| **密码登录** | 账号（智能识别）→ 密码 → 记住我 / 忘记密码 | `auth.login.password` |
| **验证码登录** | 手机号/邮箱 → 图形验证码（按需）→ 验证码 + 60s 倒计时 | `auth.login.email_otp` \|\| `auth.login.sms_otp` |
| **扫码登录** | GitHub / 微信 图标按钮 | `auth.login.github` \|\| `auth.login.wechat` |

> 基础登录模式为「密码登录」。收码登录入口仅在 `auth.login.email_otp` 或 `auth.login.sms_otp` 任一开启时渲染。

**渲染开关必须来自服务端**。这里有一个极易踩的坑：现有 `GET /api/config` 是需要登录态的，登录页拿不到。所以需要新增一个**白名单公开配置接口**：

```
GET /api/config/public
→ { success: true, data: { "auth.login.password": true, "auth.login.sms_otp": false, ... } }
```

只返回 `auth.*` 前缀 + `register.enabled` 这几个键，绝不透出 prompt / API Key 类配置。

### 4.3 验证码机制设计（安全 + 成本双约束）

这部分的每一条都是防「短信轰炸」的必需品——没有图形验证码的短信接口，一天能被刷掉几百块。

| 维度 | 设计 |
|---|---|
| 存储 | 只存 `codeHash = HMAC-SHA256(code, CODE_SECRET + target)`，**明文永不落库、永不写日志** |
| 有效期 | 5 分钟（可配 `auth.otp.ttl_seconds`） |
| 重发间隔 | 同 target 60 秒内不可重发（前端 60s 倒计时 + 后端独立校验，不信前端） |
| 频次上限 | 同 target 1 小时 5 条；同 IP 1 天 20 条；同 target 1 天 10 条 |
| 错误上限 | 累计校验失败 5 次即作废该验证码，须重新获取 |
| 一次性消费 | 校验成功立即写 `consumed_at`，同一码不可复用（防重放） |
| 前置防刷 | 图形验证码 / 滑块：同 IP 今日第 3 次请求起**强制**（`auth.captcha.required`） |
| 开发期体验 | `AUTH_OTP_DEV_PRINT=true` 时验证码打印到服务端控制台，本地开发无需真实短信/邮件 |
| 时序安全 | 哈希比对用常量时间比较（`crypto.timingSafeEqual`），不用 `===` |

**通道抽象层**——把「发什么」和「怎么发」解耦，这是让开发不被外部资质卡住的关键：

```
server/src/auth/providers/
  types.ts              interface SmsProvider  { send(phone, code, scene) }
                        interface MailProvider  { send(email, code, scene) }
  sms.tencent.ts        腾讯云 SMS（生产）
  sms.console.ts        控制台打印（开发 / 演示）
  mail.smtp.ts          nodemailer SMTP（生产）
  mail.console.ts       控制台打印（开发 / 演示）
  index.ts              按 env 的 SMS_PROVIDER / MAIL_PROVIDER 选择实现
```

业务代码只依赖 `smsProvider.send(...)`，**切换通道 = 改一个环境变量**，业务逻辑零改动。

### 4.4 验证码登录时序

```
用户              登录页              /api/auth/send-code        /api/auth/login-by-code
 │                  │                        │                          │
 │ 输入手机号/邮箱   │                        │                          │
 │─────────────────>│                        │                          │
 │                  │ ① 前端识别标识类型       │                          │
 │                  │ ② 校验格式 + 60s 冷却    │                          │
 │ 点击「获取验证码」 │                        │                          │
 │─────────────────>│───────────────────────>│                          │
 │                  │                        │ ③ 频次/节奏/图形验证校验   │
 │                  │                        │ ④ 生成 6 位码 → 存哈希     │
 │                  │                        │ ⑤ 调 Provider 下发        │
 │                  │<───────────────────────│ ⑥ 返回 { expiresIn: 300 } │
 │ 收到验证码        │ ⑦ 启动 60s 倒计时        │                          │
 │ 输入验证码 → 登录  │                        │                          │
 │─────────────────>│───────────────────────────────────────────────>  │
 │                  │                        │ ⑧ 取最近未消费的码        │
 │                  │                        │ ⑨ 校验未过期/未超次数      │
 │                  │                        │ ⑩ 常量时间比对哈希        │
 │                  │                        │ ⑪ 标记 consumed + 清失败数 │
 │                  │                        │ ⑫ 账号存在？→ 签发 JWT    │
 │                  │<───────────────────────────────────────────────  │
 │                  │ ⑬ 存 Token → 跳 /dashboard                        │
```

**一个业务决策要确认**：验证码登录时，如果该手机号/邮箱**尚未注册**，是拒绝还是自动注册？
建议「**自动注册并发 JWT**」（国内 App 主流体验），但这会与现有 `auth.register.enabled` 开关冲突，所以要独立加一个开关 `auth.login.otp_auto_register`（默认 `false`，即默认必须先注册）。

### 4.5 登录方式开关（复用系统配置架构）

这是本项目架构的最大红利——`CONFIG_SCHEMA` 是 schema 驱动的，登记一条配置项，**后端校验 + 前端「系统设置」页表单自动出现，零前端改动**。

在 `server/src/config/schema.ts` 的 `ConfigGroup` 联合类型中新增 `"auth"`，然后登记：

| key | type | 默认值 | 说明 |
|---|---|---|---|
| `auth.register.enabled` | boolean | `true` | 是否开放自助注册 |
| `auth.login.password` | boolean | `true` | 密码登录（总开关） |
| `auth.login.username` | boolean | `true` | 允许用用户名登录 |
| `auth.login.phone` | boolean | `false` | 允许用手机号 + 密码登录 |
| `auth.login.email_otp` | boolean | `false` | 邮箱验证码登录 |
| `auth.login.sms_otp` | boolean | `false` | 手机号短信验证码登录 |
| `auth.login.otp_auto_register` | boolean | `false` | 验证码登录时未注册是否自动注册 |
| `auth.login.github` | boolean | `false` | GitHub OAuth 登录 |
| `auth.captcha.required` | boolean | `true` | 发送验证码前强制图形验证 |
| `auth.otp.ttl_seconds` | number | `300` | 验证码有效期（min 60 / max 600） |
| `auth.otp.resend_seconds` | number | `60` | 重发冷却秒数（min 30 / max 300） |
| `auth.otp.daily_limit` | number | `10` | 单标识每日上限（min 1 / max 100） |
| `auth.password.min_length` | number | `8` | 密码最小长度（min 6 / max 32） |

### 4.6 Token 与安全增强

| 项 | 现状 | 设计 |
|---|---|---|
| Token 失效 | 仅靠 `status` 实时校验 | 新增 `tokenVersion` 写入 JWT payload（`tv`）；`authMiddleware` 查库时一并取出比对，不一致 → `401 TOKEN_REVOKED` |
| 版本号自增时机 | — | 改密码、管理员重置密码、强制下线、解绑登录标识 |
| 登录审计 | 无 | 登录成功/失败都写 `login_logs`，同时回写 `lastLoginAt` / `lastLoginIp` |
| 强制改密 | 无 | `mustChangePassword = true` 时，前端在 `/dashboard` 布局层拦截并跳 `/dashboard/profile` 改密 |
| 邮箱/手机号变更 | — | 必须走验证码验证新标识（`scene=bind_email` / `bind_phone`），防越权改绑 |

> `authMiddleware` 现在本来就查库了，**加 `tokenVersion` 只是同一句 `select` 多带一列，不增加查询次数、不增加 DB 压力**。

### 4.7 新增 API 一览

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| POST | `/api/auth/login` | 公开 | 统一登录。body: `{ identifier, password }`；**缺省 `identifier` 时回退读 `email`，向前兼容不破坏现有前端** |
| POST | `/api/auth/send-code` | 公开 | 发送验证码。body: `{ identifier, scene, captchaToken? }` |
| POST | `/api/auth/login-by-code` | 公开 | 验证码登录。body: `{ identifier, code }` |
| POST | `/api/auth/reset-password` | 公开 | 忘记密码。body: `{ identifier, code, newPassword }` |
| GET | `/api/auth/login-methods?identifier=` | 公开 | 查该标识可用的登录方式（前端据此给提示，**注意不做用户枚举泄露**，只返回「是否已注册」布尔值不够，建议统一返回通用文案） |
| GET | `/api/auth/oauth/github` | 公开 | 跳转 GitHub 授权 |
| GET | `/api/auth/oauth/github/callback` | 公开 | 回调换 JWT（`state` 防 CSRF） |
| POST | `/api/auth/set-password` | 登录态 | 强制改密 / 验证码用户首次设密 |
| GET | `/api/config/public` | 公开 | **白名单**公开配置（仅 `auth.*` + `register.enabled`） |
| POST | `/api/user` | `system:user:create` | 管理员新增用户 |
| PUT | `/api/user/:id` | `system:user:update` | 编辑用户（昵称 / 标识 / 状态） |
| POST | `/api/user/:id/reset-password` | `system:user:reset-password` | 重置密码 |
| DELETE | `/api/user/:id` | `system:user:delete` | 删除用户（**软删除**） |
| GET | `/api/user/check-identity` | `system:user` | 唯一性即时校验（`field` + `value`） |
| POST | `/api/user/batch-import` | `system:user:import` | 批量导入（可选，P2） |

---

## 五、用户管理页「新增用户」设计

### 5.1 从现状到目标

**现状**（`app/dashboard/system/user/page.tsx`，339 行）：只有「列表 + 搜索 + 分配角色 + 停用/启用」。
**目标**：补齐完整的用户 CRUD 闭环。

| 区域 | 新增内容 |
|---|---|
| 页头 | 主按钮「＋ 新增用户」（`type="primary"`，`disabled={!canCreate}`）；可选「批量导入」「导出」 |
| 表格列 | 增加「登录标识」展示（邮箱 / 手机号 / 用户名 全展示，缺失显示 `—`）、「最后登录」列 |
| 操作列 | 在「分配角色 / 停用」前补「编辑」「重置密码」；末尾加「删除」（`danger`） |
| 筛选 | 增加「状态」筛选（全部 / 正常 / 已停用）、「角色」筛选 |

### 5.2 新增用户弹窗

**尺寸**：`width={640}`，`destroyOnClose`，成功后重置表单。
**特殊设计**：创建成功后**不立即关闭**，切换为「结果态」（见 5.3 模式②），因为随机初始密码只展示这一次。

| 字段 | 控件 | 必填 | 校验规则 |
|---|---|---|---|
| 邮箱 | `Input` | 三选一 | 邮箱格式 + 全局唯一；用于邮箱验证码与登录 |
| 手机号 | `Input` | 三选一 | `^1[3-9]\d{9}$` + 全局唯一 |
| 用户名 | `Input` | 三选一 | `^[a-zA-Z0-9_-]{3,20}$` + 全局唯一 + **禁止纯数字**（避免与手机号判定冲突） |
| 昵称 | `Input` | 否 | ≤ 20 字 |
| 密码模式 | `Radio.Group` | 是 | 三选一（见 5.3） |
| 初始密码 | `Input.Password` | 条件 | 模式①显示。≥ `auth.password.min_length`，含大写+小写+数字；带强度条 |
| 角色 | `Select` multiple | 是 | 默认 `user`；选中 `admin` 时后端强校验操作者身份 |
| 账号状态 | `Radio.Group` | 是 | 默认「启用」 |
| 首次登录强制改密 | `Switch` | 否 | 默认开启（模式① ② 可用） |
| 备注 | `Input.TextArea` | 否 | ≤ 100 字（需给 `User` 加 `remark` 字段，可选） |

**「三选一」的交互技巧**：不要用 Radio 让用户先选类型。三个输入框并排，实时提示「至少填写一项作为登录标识」，先填哪个哪个生效。这样管理员想建「只有手机号的后台账号」时不用多点一步。

### 5.3 三种密码模式

| 模式 | 交互 | 适用 | 安全性 |
|---|---|---|---|
| ① 管理员设置初始密码 | 显示密码输入框 + 强度条 + 「生成随机密码」快捷按钮 | 内部测试账号、需要立刻交付 | 中（管理员知悉密码） |
| ② **系统生成随机密码**（推荐默认） | 创建后进入结果态，一次性展示 12 位随机密码 + 「复制全部」+「我已记录，关闭」 | 绝大多数场景 | 高（明文仅在响应中出现一次） |
| ③ 不设密码，发送邀请 | 创建后 `password = null` + `mustChangePassword = true`，通过邮件/短信发一次性链接让用户自己设密 | 正式员工、外部用户 | **最高**（管理员全程不知道密码） |

模式③本质是「`scene=invite` 的验证码 + 设置密码」组合，P1 阶段可以先用模式②等价替代（把随机密码通过邮件发出去），P2 再补完整邀请链接。

### 5.4 后端 `createUser` 处理流程

```
POST /api/user
 ① requirePermission(SYSTEM_USER_CREATE)               ← 权限闸门
 ② 参数校验：至少一个登录标识 / 格式 / 长度
    └─ 复用 assertHasLoginIdentity()，与注册链路同一个函数
 ③ 唯一性：findFirst({ OR: [{email}, {phone}, {username}] })
    └─ 冲突时明确告知「邮箱已被占用」而不是笼统的「创建失败」
 ④ 提权防护：roleIds 含 admin → 操作者必须具 admin 角色
    └─ 把现有 assignRoles() 里的这段逻辑抽成 assertCanAssignRoles(operatorId, roleIds)，
       在「新增用户」和「分配角色」两处共用，避免两套判断逻辑漂移
 ⑤ 密码处理：
    ├─ 模式① 用传入密码
    ├─ 模式② crypto.randomBytes() + 字符表生成 12 位（保证四类字符都出现）
    └─ 模式③ password = null
    → bcrypt.hash(pwd, BCRYPT_SALT_ROUNDS)
 ⑥ prisma.$transaction：create user + createMany(userRoles)
    └─ 与现有 register() 保持一致的原子性写法
 ⑦ 写 login_logs（可选）或独立 audit 表
 ⑧ 返回：绝不返回 password 哈希；
    仅模式② 在本次响应中返回一次 initialPassword 明文字段
```

### 5.5 权限码与菜单节点

**两处必须同步修改**（项目约定：`server/src/middleware/rbac.ts` 的 `PERMISSION_CODES` ⇄ `lib/permissions.ts` 的 `PERMISSIONS`）：

| 新增权限码 | 中文名 | 类型 |
|---|---|---|
| `system:user:create` | 新增用户 | button |
| `system:user:update` | 编辑用户 | button |
| `system:user:delete` | 删除用户 | button |
| `system:user:reset-password` | 重置密码 | button |
| `system:user:import` | 批量导入 | button（P2） |

同时在 `menus` 表里作为 `type = "button"` 节点挂到「用户管理」菜单下（`code` 即权限码，现有 RBAC 体系已原生支持），并同步更新 seed 脚本。前端按钮用 `hasPermission(PERMISSIONS.USER_CREATE)` 控制显隐，后端接口用 `requirePermission()` 兜底——**现有页面已经是这个双保险写法，新增按钮沿用即可**。

### 5.6 安全红线（逐条必须守）

1. **绝不返回 `password` 哈希**。所有用户查询沿用现有 `select` 白名单写法，新增接口也必须显式 select。
2. **模式②的明文初始密码只在创建响应里出现一次**：不落库、不写日志、不缓存。
3. **分配 `admin` 角色必须操作者本身是 admin**。复用 `assignRoles` 里的提权防护，抽成公共函数。
4. **不能删除 / 停用自己**（现有 `setStatus` 已有此判断，`deleteUser` 必须同样加）。
5. **不能删掉系统里最后一个 admin**，否则系统永久锁死。
6. **删除用户必须用软删除**（`deletedAt`）。这是本设计最重要的一条风险提示：
   `User` 被 `user_profiles` / `documents` / `chunks` / `knowledge_files` / `trace_runs` / `user_roles` 关联，其中多条带 `onDelete: Cascade`。**物理删除用户会连带清空该用户的全部简历、知识库文档与 AI 执行轨迹**。所以：
   - `deleteUser` 只写 `deletedAt` + 清 `email/phone/username` 之外的状态（或保留标识但标记删除）
   - 所有查询（登录、列表）追加 `deletedAt: null` 条件
   - 列表默认不展示已删除用户，提供「回收站」入口才可见（可选）
7. **列表 / 查询统一排除 `deletedAt != null`**，否则删除的用户还能登录。这是软删除最容易漏的一环。

### 5.7 改动文件清单

**服务端新增**

| 文件 | 说明 |
|---|---|
| `server/src/auth/providers/*.ts` | 短信 / 邮件通道抽象 + 腾讯云、SMTP、Console 三种实现 |
| `server/src/services/verification.service.ts` | 验证码生成、哈希存储、频控、校验、消费 |
| `server/src/services/oauth.service.ts` | GitHub OAuth 换 token / 取用户 / 绑定 `user_identities` |
| `server/src/services/userAdmin.service.ts` | **在现有文件上扩展** `createUser` / `updateUser` / `resetPassword` / `deleteUser` |
| `server/src/lib/identifier.ts` | `resolveIdentifier()` + `assertHasLoginIdentity()`（前后端共用的判定规则单一事实源） |
| `server/src/routes/config.routes.ts` | **在现有文件上新增** `GET /public` 白名单公开配置 |

**服务端修改**

| 文件 | 变更 |
|---|---|
| `server/prisma/schema.prisma` | User 加 7 个字段；新增 3 张表 |
| `server/src/services/auth.service.ts` | `login()` 支持 `identifier`；新增 `loginByCode()` / `resetPassword()`；JWT 加 `tv` |
| `server/src/middleware/auth.ts` | 校验 `tokenVersion`；加 `deletedAt: null` 条件 |
| `server/src/middleware/rbac.ts` | 加 5 个权限码 |
| `server/src/config/schema.ts` | `ConfigGroup` 加 `"auth"`；登记 13 个配置项 |
| `server/src/routes/auth.routes.ts` | 新增 6 条路由 |
| `server/src/routes/adminUser.routes.ts` | 新增 5 条路由 |
| `server/src/types/index.ts` | 补 `LoginRequest.identifier` 等类型 |
| `server/prisma/seed*.ts` | 菜单 button 节点 + 新权限码 |

**前端新增 / 修改**

| 文件 | 变更 |
|---|---|
| `app/login/page.tsx` | Tab 化（密码 / 验证码 / 扫码）；智能标识输入框；接 `config/public` |
| `app/register/page.tsx` | 「用户名」字段语义修正为真正的 `username`（见 6.8） |
| `app/forgot-password/page.tsx` | 新增：验证码 → 设新密码 |
| `app/dashboard/system/user/page.tsx` | 新增按钮 + 创建弹窗 + 编辑 / 重置密码 / 删除 |
| `app/dashboard/system/user/CreateUserModal.tsx` | 新增组件（含结果态） |
| `api/modules/auth.ts` | 加 `sendCodeApi` / `loginByCodeApi` / `resetPasswordApi` |
| `api/modules/user.ts` | 加 `createUserApi` / `updateUserApi` / `resetUserPasswordApi` / `deleteUserApi` / `checkIdentityApi` |
| `lib/permissions.ts` | 同步 5 个权限码 |

**环境变量新增**（`.env.docker.example` 同步）

```
JWT_SECRET                    （已有）
VERIFY_CODE_SECRET            验证码 HMAC 密钥
AUTH_OTP_DEV_PRINT=false      开发期控制台打印验证码
SMS_PROVIDER=mock             mock | tencent
TENCENT_SMS_SECRET_ID / SECRET_KEY / SDK_APP_ID / SIGN_NAME / TEMPLATE_ID
MAIL_PROVIDER=mock            mock | smtp
SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / MAIL_FROM
GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET / GITHUB_CALLBACK_URL
```

---

## 六、风险与注意事项

1. **`password` 由必填改可空是破坏性 schema 变更**。建议先在测试库 `npx prisma db push`，确认现有用户登录不受影响，再动生产。现有行都有密码值，改可空不会影响存量数据。
2. **`email` 改可空**后，必须补应用层「至少一个登录标识」校验，否则能创建出无法登录、也无法被找回的孤儿账号。
3. **短信资质是唯一的外部排期风险**。个人主体通常只能申请到测试签名/模板，且有白名单号码限制。所以「先邮箱、后短信」的顺序不是偏好，是工程上的必然。
4. **短信轰炸是真实的钱**。图形验证码 + 频控必须和短信通道同期上线，不能「先上功能后补防护」。
5. **软删除的漏网点**：登录查询、`authMiddleware` 查库、用户列表、角色分配、`assignRoles` 的 `findUnique` —— 每处按 id 或标识查 User 的地方都要加 `deletedAt: null`（或改用统一的 `findActiveUser()` 封装）。建议直接封装成函数，从源头避免遗漏。
6. **`mustChangePassword` 的拦截位置**应在 `app/dashboard/layout.tsx`（现有布局层）而不是每个页面各写一遍。
7. **登录页现有 `href="#"` 死链**顺手补成 `/forgot-password`。
8. **存量 `name` 不能直接迁移为 `username`**。现有 `User.name` 是用户随便填的昵称（注册页 placeholder 就是「您的姓名或昵称」），可能重复、含中文、超长。迁移策略只能是：`name` 原样保留，`username` 全部留空，由用户在「个人中心 → 账号安全」里自行绑定。这一步要在 PRD 里写清楚，否则上线后会出现一批用户名撞车的账号。
9. **登录标识识别规则必须前后端同源**。如果前端判定为「手机号」而后端判定为「用户名」，会出现「提示手机号登录、实际按用户名查」的诡异失败。所以要有 `server/src/lib/identifier.ts` 这个单一事实源（前端可以复制一份常量 + 单测覆盖同一组用例）。

---

## 七、落地路线（双轨并行）

```
轨道 A：登录方式                 轨道 B：用户管理
──────────────────────          ──────────────────────
A-P0  账号模型 + 统一登录入口       B-P0  新增用户（邮箱+密码 最小闭环）
      · User 加字段/建表                 · 权限码 + 菜单节点
      · identifier 识别                 · 创建弹窗（模式① ②）
      · tokenVersion                    · 后端 createUser
      · /api/config/public
      ↓ 半天~1 天                       ↓ 1 天
A-P1  验证码体系（邮箱优先）         B-P1  编辑 / 重置密码 / 软删除
      · 验证码表 + 频控 + 防刷            · 唯一性即时校验
      · 邮箱验证码登录                    · 不能删最后一个 admin
      · 忘记密码                        ↓ 0.5 天
      · 短信通道（Mock 兜底）
      ↓ 2~3 天
A-P2  GitHub OAuth + 登录日志       B-P2  批量导入 / 导出 / 回收站
      ↓ 2~3 天                         ↓ 1~2 天
A-P3  微信扫码 / Passkey（按需）
```

**建议起点**：先做 A-P0 + B-P0。这两块没有任何外部依赖，做完就能得到一个「多标识登录 + 管理员可新增用户」的完整闭环，而且**不影响现有邮箱登录**（`/api/auth/login` 保持对 `{ email, password }` 的向后兼容）。

---

## 八、待确认问题 → 已全部拍板

> 以下 6 个问题已由需求方逐条确认，结论即最终实施口径，原问题保留以便回溯。

| # | 问题 | 决策结论 |
|---|------|----------|
| 1 | 短信服务商资质 | **个人开发，无短信资质** → A-P1 先做邮箱验证码（零资质）；短信通道代码同步写好，用 Mock Provider 兜底，`auth.login.sms_otp` 默认关闭 |
| 2 | 新增用户默认密码模式 | **新增系统配置项 `auth.user.default_password`**（内置复杂密码，配置页明文展示可改）；**新增用户时可选「使用系统默认密码」或「管理员自行设置」** |
| 3 | 登录入口形态 | **一个智能输入框**（邮箱含 `@` → 手机号 → 用户名，前端只提示不拆分字段，后端为权威判定） |
| 4 | 删除用户 | **软删除**（`User.deletedAt`），登录/鉴权/列表全部过滤，唯一性校验不过滤（与 DB 唯一索引口径一致） |
| 5 | 批量导入 Excel | **暂不做**（B-P2 保留） |
| 6 | 验证码登录遇未注册标识 | **自动注册**，前端明确文案告知用户「已为你创建账号」，由 `auth.login.otp_auto_register` 开关控制（默认 `true`） |

---

## 九、实施状态（A-P0 + B-P0 已完成）

> 状态：**已实施并自测通过**（2026-10-14）
> 验证口径：后端接口端到端自测 **26/26 通过**；前端 `tsc --noEmit` 0 错误、`eslint` 0 问题。

### 9.1 A-P0 登录方式（已完成）

| 子任务 | 内容 | 状态 |
|--------|------|------|
| A-P0-1 | Prisma `User` 扩展：`email`/`phone`/`username` 三个可空唯一标识 + `tokenVersion` + `mustChangePassword` + `lastLoginAt/Ip/Method` + `deletedAt` | ✅ |
| A-P0-2 | `server/src/lib/identifier.ts`（标识识别单一事实源）、`user-query.ts`（软删除过滤统一封装）、`password.ts`（密码策略） | ✅ |
| A-P0-3 | 登录链路改造：`identifier` 统一入口（兼容旧 `{email}`）+ JWT 写入 `tv` + 中间件比对 `tokenVersion` 实现主动吊销 | ✅ |
| A-P0-4 | 系统配置新增 `auth` 分组（14 项）与 `GET /api/config/public` 公开白名单（免登录，注册在 `/:key` 之前避免被通配捕获） | ✅ |
| A-P0-5 | 登录页重写为单一「账号」智能输入框（前缀图标随识别结果切换 + 「已识别，将按「XX」登录」提示）；注册页 `username` 修正为真正的登录账号 | ✅ |
| A-P0-6 | **「首次登录强制修改密码」闭环补完**（2026-10-14 追加，见 9.4） | ✅ |

**A-P0 修掉的三处真实缺陷**：
1. 注册页把「用户名」误写进了 `User.name`（昵称），系统实际上没有「账号密码登录」能力 —— 现已写入真正的 `User.username`。
2. 改密码后旧 JWT 仍然有效 —— 引入 `tokenVersion`，改密/重置时 `increment`，旧 Token 立即返回 `401 TOKEN_REVOKED`。
3. 「忘记密码？」是死链 —— 暂改为 disabled + `title` 说明（归属 A-P1）。

### 9.2 B-P0 用户管理「新增用户」（已完成）

| 子任务 | 内容 | 状态 |
|--------|------|------|
| B-P0-6 | 新增权限码 `system:user:create`（`rbac.ts` ⇄ `lib/permissions.ts` 双处同步）+ 菜单种子新增「新增用户」按钮节点（menus=21 条） | ✅ |
| B-P0-7 | 后端 `userAdmin.service.createUser()` + `assertCanAssignRoles()`（提权防护，与「分配角色」共用）+ `checkIdentifier()`；路由 `POST /api/user`、`GET /api/user/check-identity` | ✅ |
| B-P0-8 | 前端 `CreateUserModal.tsx` + 用户管理页「+ 新增用户」入口、表格升级为「登录标识」列与「最后登录」列 | ✅ |
| B-P0-9 | 端到端自测 + 本文档更新 | ✅ |

### 9.4 强制改密闭环补完（A-P0-6，2026-10-14 追加）

**背景**：B-P0-8 上线后实测发现，勾选「首次登录强制修改密码」只写入了
`User.mustChangePassword = true`（写入端），**消费端整条链路缺失** —— 登录页
登录成功后无条件跳 `/dashboard`，后端也没有任何拦截，用户完全感受不到强制。

**四层实现（缺任一层都能被绕过）**：

| 层 | 位置 | 作用 |
|----|------|------|
| ① 后端硬闸门 | `server/src/middleware/auth.ts` 的 `authMiddleware` 内新增步骤 5 | `mustChangePassword=true` 时，除白名单外所有接口返回 `403 PASSWORD_CHANGE_REQUIRED`。白名单仅两项：`PUT /api/user/password`（改密本身）与 `GET /api/user/profile`（改密页要显示当前账号）。用「默认拒绝 + 白名单」而非黑名单：新增接口默认被拦，最坏是暂时不可用，不会静默失守。路径判定用 `originalUrl` 去查询串 + 去尾斜杠，防 `?x=1` / `/` 绕过 |
| ② 登录页分流 | `app/login/page.tsx` | 登录响应里 `mustChangePassword=true` → `router.replace("/change-password")`（不 `setLoading(false)`，避免按钮闪回可用态） |
| ③ 拦截器兜底 | `api/client.ts` | 响应拦截器识别 `403 + PASSWORD_CHANGE_REQUIRED` → `window.location.replace("/change-password")`。这是用户手敲 `/dashboard/xxx` 直接进来时的最后一道防线；已在改密页上时不再跳转，防自我重定向死循环 |
| ④ 强制改密页 | `app/change-password/page.tsx`（新建，顶层路由） | 不在 `dashboard` 下，因此没有侧边栏可以溜走。挂载时先调 `GET /api/user/profile` 自检：标记已是 `false` 就直接放行进应用（防历史链接卡人）；展示「当前账号」的标识 Tag；表单走统一密码策略；底部保留「退出登录」按钮，防止改不了密码的账号被锁死 |

**改密成功后的收尾（两个入口统一）**：后端 `changePassword` 会 `tokenVersion++`
吊销**所有**旧 Token（含本次会话），因此无论从强制改密页还是个人中心改密，
前端统一「清本地 Token → 跳 `/login?passwordChanged=1`」，登录页读该参数展示
一次性成功提示（读后即 `history.replaceState` 抹掉，避免刷新反复出现）。

**顺带修复**：个人中心改密成功回调原先**丢弃了后端返回的新 Token** —— 而后端
已吊销旧 Token，导致用户改完密码下一步操作就吃 401 被静默踢下线；同时把硬编码
的 `min: 6` 校验替换为统一的 `lib/password.ts`（对齐配置项
`auth.password.min_length`）。

**验证**：19 项端到端断言全绿（登录带标记 / 白名单放行 / 非白名单 403 /
查询串与尾斜杠不可绕过 / 旧密码错 400 / 弱密码 400 / 改密成功返回新 Token /
旧 Token 401 / 新 Token 通行 / 标记清零 / 新密码重登）；真实浏览器走查确认
「手敲 /dashboard 被弹回改密页」。

### 9.5 「新增用户」弹窗的落地细节

- **三个登录标识平铺**（邮箱 / 手机号 / 用户名），各自 `onBlur` 500ms 防抖调 `check-identity` 提前提示占用；接口异常时**降级放行**，判定权交后端（前端校验只是体验优化，不是安全边界）。
- **「至少一个标识」** 在提交前整体校验，用 `message` 明确指出缺失项（跨字段规则用单字段 `rule` 表达很别扭）。
- **密码来源二选一**：`default` 时展示系统默认密码（仅当操作者拥有 `system:config` 权限才展示明文，否则只提示「来自系统配置」）；`custom` 时走强度校验（长度 + 字母数字混合 + 拒绝单一重复字符），规则与后端 `assertPasswordStrength` 逐条对齐。
- **角色多选由父页面传入的 `canGrantRole` 控制**：后端 `POST /api/user` 只要求 `system:user:create`，若操作者没有 `system:user:grant`，前端隐藏角色选择、不传 `roleIds`，由后端绑定默认 `user` 角色 —— 避免「用 create 接口实现提权」。
- **成功后弹「账号摘要」**：列出登录账号、密码来源（含明文值，若有权限）、角色、以及「已开启首次登录强制改密」提示，方便管理员转告新用户。

### 9.4 B-P0 边界（明确未做，防止误解）

- 编辑用户、重置密码、UI 上的「删除用户」按钮 → **B-P1**
- 批量导入 / 导出 / 回收站 → **B-P2**
- 验证码登录（邮箱 / 短信）、忘记密码找回 → **A-P1**（登录页当前为占位 Alert 说明）

### 9.5 改动文件清单（实际）

**后端（my-app/server）**
```
prisma/schema.prisma                    User 模型扩展（三标识可空唯一 + 软删除 + tokenVersion）
prisma/seed-roles.ts                    菜单种子 +system:user:create（menus 21 条）
src/lib/identifier.ts             [新]  标识识别单一事实源
src/lib/user-query.ts             [新]  软删除过滤统一封装（含 findIdentifierConflict 不过滤）
src/lib/password.ts               [新]  密码策略（强度校验 + crypto.randomInt 生成随机密码）
src/services/auth.service.ts            统一登录入口 + generateToken 写入 tv
src/services/user.service.ts            改密支持无密码账号首设 + tokenVersion++ 返回新 Token
src/services/userAdmin.service.ts       createUser / assertCanAssignRoles / checkIdentifier
src/controllers/auth.controller.ts      错误码映射（PASSWORD_WEAK/IDENTIFIER_INVALID/…）
src/controllers/user.controller.ts      changePassword 返回新 Token
src/middleware/auth.ts                  tv 比对 → 401 TOKEN_REVOKED
src/middleware/rbac.ts                  PERMISSION_CODES +USER_CREATE
src/routes/adminUser.routes.ts          POST /api/user、GET /api/user/check-identity
src/routes/config.routes.ts             GET /api/config/public（注册在 /:key 之前）
src/config/schema.ts                    ConfigGroup +auth、PUBLIC_CONFIG_KEYS、14 个 auth 配置项
src/config/config-service.ts            getPublicConfigs()
src/types/index.ts                      新增/扩展类型
```

**前端（my-app）**
```
lib/identifier.ts                 [新]  与后端同源的标识识别镜像（只提示不拆分字段）
lib/password.ts                   [新]  密码强度校验镜像
lib/permissions.ts                      PERMISSIONS +USER_CREATE
api/types.ts                            CreateUserParams/Result、IdentifierCheckResult、PublicConfigMap、新错误码
api/modules/{auth,user,config}.ts       createUserApi / checkIdentityApi / getPublicConfigsApi
api/index.ts                            导出新增能力
app/login/page.tsx                      单一智能输入框 + Segmented 方式切换
app/register/page.tsx                   username 作为登录账号 + 密码规则取公开配置
app/dashboard/system/user/page.tsx      「+ 新增用户」+ 登录标识列 + 最后登录列
app/dashboard/system/user/CreateUserModal.tsx  [新] 新增用户弹窗
app/dashboard/system/config/page.tsx    本地 GROUP_LABELS 补 auth 分组
```

### 9.6 自测覆盖（26/26）

配置生效值（3）· `check-identity` 三态（3）· 默认密码建号（5）· 三标识登录含大小写归一（3）· 重复标识 400（1）· 无标识 400（1）· 弱密码拦截（1）· 仅手机号建号（3）· 含空格手机号登录（1）· 列表字段与关键字检索（3）· 数据清理（1）

另单独验证过：`tokenVersion` 吊销（旧 Token 401、新 Token 200）、软删除全链路（软删后有效 Token 立即失效 + 无法登录 + 不在列表，再恢复）、权限闸门 403、提权防护 400「只有管理员可以分配管理员角色」。


### 9.7 个人中心三分区重排 + 修改登录标识（2026-10-14 第二轮追加）

**背景**：统一账号模型上线后，个人中心没有跟上——邮箱是 disabled 只读、
新增的 username/phone 没有任何展示位、改密码入口藏在一个文字链接里、
后端早已记录的 lastLoginAt/Ip/Method 一个字没展示。

**改标识的安全决策（用户已拍板）**：
- 无邮件/短信服务商资质，无法做「新邮箱收验证码」→ 采用**当前密码确认**折中方案；
- 「至少保留一个登录标识」为前后端硬规则（复用 normalizeAndValidateIdentifiers）；
- 界面如实标注「未验证」Tag，等 A-P1 有验证码能力再升级，不假装已验证。

**新接口**：`PUT /api/user/identifiers`
- 必带 `password`（无密码账号跳过）；PATCH 语义：undefined=保持原值、""/null=清空；
- 「合并再校验」是关键：直接拿入参覆盖会把「只改邮箱」的请求连手机号用户名一起清掉；
- 唯一性校验 `findIdentifierConflict(input, excludeUserId)` 需排除自己；
- 邮箱变更时重签同 tokenVersion 的 Token（同步 JWT payload），不吊销其它设备；
- 强制改密账号被 PASSWORD_GATE_WHITELIST 天然拦下（不在白名单），符合预期。

**前端三分区**：基本资料（头像/昵称/简介）· 登录与安全（三标识行 + 修改密码按钮
+ 最后登录信息）· 集成设置（两个 Key 卡片，新增 `embedded` 模式避免卡中卡）。
新组件：`app/dashboard/profile/components/IdentifierModal.tsx`。

**主题跟随（登录 / 注册 / 强制改密页）**：
- 新建 `components/auth/AuthShell.tsx`：`AuthThemeProvider`（antd 算法随 next-themes）
  + `AuthShell`（背景/光晕/网格/毛玻璃卡片全部走 CSS 变量）；
- 三个页面从写死 `bg-[#050505]` / `text-white/xx` 全部改为
  `--background/--foreground/--card/--border/--muted-foreground`；
- **顺带修复**：`--bg-soft / --border-1 / --accent-1 / --text-3 / --warning` 这些变量
  此前只被引用、从未定义（Key 卡片的底色边框一直在默默失效），已在
  `app/globals.css` 的 `:root` 与 `.dark` 中补上真实取值。

**验证**：
- 后端 36 项断言全绿（PATCH 语义 / 密码校验 / 格式 / 唯一性含软删除 / 至少一个
  / 重签 Token / 改后新标识登录 / 手机号归一化 / 清空可选标识 / 强制改密闸门）；
- 浏览器走查：浅色登录页 → 登录 → 个人中心三分区 → 改邮箱成功且列表即时更新
  → 切深色 → 退出 → 深色登录页 → 强制改密账号分流 → 改密页深/浅两套主题
  → 改密成功 → 登录页成功提示；
- antd v6 弃用警告再清两处：`Space direction` → `orientation`（3 处）、
  Key 卡片 `Alert message` → `title`（2 处），devtools 角标归零；
- 顺手修掉两个 Key 卡片的历史 lint 错误（loadStatus 声明顺序 + 未用变量）。
