# PRD：角色-菜单权限体系（RBAC + 动态菜单）

> 版本：v1.0　|　作者：许清楚（产品经理）　|　状态：待评审
> 项目：ai-job-platform（CareerAI）

---

## 0. 项目信息

| 项 | 内容 |
|---|---|
| 文档语言 | 中文 |
| 项目名 | ai-job-platform |
| 技术栈 | 主应用 Next.js 16 App Router + React 19 + Ant Design 6 + Tailwind CSS 4；后端 Express 5 + Prisma 7 + PostgreSQL 16 + JWT；子应用 Vite + React（qiankun） |
| 涉及模块 | 后端 `my-app/server`（Prisma / middleware / routes）、主应用 `my-app`（layout / api / pages） |
| 原始需求 | ① 角色与菜单绑定，按绑定关系控制不同角色显示不同菜单；② 新增「菜单管理」「角色管理」页面；③ 新开「系统设置」大菜单（目录），下辖基础配置（原配置中心平移）、菜单管理、角色管理；④ 菜单由后端接口返回，前端动态渲染侧边栏 |
| 主理人补充（已纳入） | ⑤ 必须有「用户管理」页（给用户分配角色），否则角色无法落地到人；⑥ 菜单支持 catalog/menu/button 三种类型，button 为按钮级权限码；⑦ 权限码命名规范；⑧ 后端接口鉴权才是安全边界，前端隐藏菜单只是体验层；⑨ 业务菜单（工作台/职位发现/简历优化/个人中心/决策历史）也必须入库 |
| 已确认产品决策（原样执行） | ⑩ admin 角色强制拥有全部权限，权限不可编辑、角色不可删除，永远全选；⑪ 权限变更「重新登录后生效」，不做实时推送；⑫ 必须支持「停用用户」（User 增加 status 字段，停用后不可登录） |

**现状基线（改造起点）**
- 已有 `Role`（code/name/description）+ `UserRole`（复合主键，多对多）两张表，`seed-roles.ts` 预置 admin/user。
- 已有 `ROLE_CODES` / `getUserRoleCodes()` / `requireRole()`，粒度只到角色。
- 已有配置中心（`SystemConfig` + `config/schema.ts` 26 项 + config-service + config.routes）与前端设置页，仅 admin 可写。
- 侧边栏菜单**硬编码**在 `components/layout/MainLayout.tsx` 的 `items` 数组（key 1–6），「系统设置」靠前端 `isAdmin()` 过滤。

---

## 1. 产品目标

1. **权限可配置**：把「菜单 → 角色 → 用户」三级关系全部搬进数据库，管理员可自助增删角色、勾选菜单权限、给用户分配角色，不再依赖改代码与重新发版。
2. **入口与鉴权一致**：侧边栏完全由后端接口返回的菜单树动态渲染，不同角色登录看到不同菜单；同时后端接口以权限码实时鉴权，做到**前端体验层隐藏 + 后端安全边界拦截**双层一致，杜绝绕过前端直接调接口的越权。
3. **权限管理闭环**：形成「建角色 → 配菜单/按钮权限 → 分配给用户 → 重新登录生效 → 可停用用户」的完整闭环，任何一步都可在页面上完成，无缺口。

**明确边界（重要）**
- 前端隐藏菜单/按钮 **不等于** 权限控制，仅减少无效交互；**真正的安全边界是后端每个管理接口的权限校验**，任何绕过前端的请求都会被 403 拦截。
- 本期权限粒度到「菜单 + 按钮（功能点）」，**不做数据行级权限**（如「只能看自己的数据」），预留扩展位。
- 权限变更不做实时推送：前端菜单/按钮可见性在**用户重新登录后**刷新（见 P0-13 的口径说明）。

---

## 2. 用户故事

| # | 角色 | User Story |
|---|---|---|
| US-1 | 系统管理员 | As a **管理员**，I want **在「角色管理」里新建角色并勾选它能访问的菜单与按钮**，So that **不同岗位的人登录后只看到各自该用的功能，无需改代码重新发版**。 |
| US-2 | 系统管理员 | As a **管理员**，I want **在「用户管理」里给某个用户分配/调整角色，并能停用离职账号**，So that **权限能真正落到具体的人身上，且离职后账号立即失效**。 |
| US-3 | 系统管理员 | As a **管理员**，I want **在「菜单管理」里维护菜单树（目录/菜单/按钮三级）**，So that **新增业务页面时只需后台配置一条菜单，无需改动侧边栏硬编码**。 |
| US-4 | 普通用户 | As a **普通用户**，I want **登录后侧边栏只出现我被授权的菜单（工作台/职位发现/简历优化/个人中心/决策历史）**，So that **界面干净、不出现点进去就报无权限的入口**。 |
| US-5 | 系统管理员 | As a **管理员**，I want **admin 角色的权限始终是全部、不可被误改或删除**，So that **不会因为一次误操作把系统锁死、谁也进不了后台**。 |
| US-6 | 安全负责人 | As a **系统管理员**，I want **即使有人绕过前端直接调管理接口，也会被后端按权限码拒绝**，So that **前端菜单隐藏只是体验优化，真正的越权风险被后端兜住**。 |

---

## 3. 需求池

优先级口径：**P0 = 必须有（缺了闭环不成立）**；**P1 = 应该有（体验与健壮性）**；**P2 = 可以有（锦上添花）**。

### 3.1 P0（Must have）

| ID | 需求 | 验收标准 |
|---|---|---|
| **P0-1** | **数据模型：Menu 表 + RoleMenu 关联表** | ① 新增 `Menu` 表，字段见附录 A：`id / parentId / type(catalog\|menu\|button) / code(唯一) / name / path? / component? / icon? / sort / visible / status / createdAt / updatedAt`；② 新增 `RoleMenu` 表（`roleId + menuId` 复合主键，双向 Cascade 删除）；③ `Role` 增加 `menus RoleMenu[]`、`Menu` 增加 `parent/children` 自引用；④ `prisma migrate` 后表结构正确，`db:seed:roles` 可重复执行不产生重复数据。 |
| **P0-2** | **种子数据：业务菜单与系统设置菜单全部入库** | ① 5 个业务菜单入库（工作台 `dashboard`、职位发现 `jobs`、简历优化 `resume`、个人中心 `profile`、决策历史 `history`），并绑定到 `user` 角色；② 系统设置目录 `system` 及 4 个二级菜单（基础配置/菜单管理/角色管理/用户管理）与按钮权限入库；③ `admin` 不写绑定记录（走强制全权），`user` 角色默认可见 5 个业务菜单；④ 权限码清单与本文 3.4 完全一致。 |
| **P0-3** | **后端：当前用户菜单接口 `GET /api/menu/my`** | ① 登录态调用返回 `{ menus: MenuTreeNode[], permissions: string[] }`；② `menus` 为 `catalog/menu` 两级（或按实际层级）树，已按 `sort` 升序，不含 `button`；③ `permissions` 为当前用户全部按钮权限码数组；④ **admin 角色返回全量菜单 + 全量权限码**（不查 RoleMenu）；⑤ 未登录返回 401，用户被停用返回 401/403。 |
| **P0-4** | **后端：`requirePermission(code)` 权限中间件** | ① 新增 `requirePermission(...codes)`，语义为「拥有任一 code 即放行」；② **admin 短路**：用户具备 admin 角色时直接 `next()`，不查 RoleMenu；③ 无权限返回 `403 { success:false, code:"FORBIDDEN" }`；④ 保留现有 `requireRole` 不破坏旧调用；⑤ 校验实时读库（不缓存用户权限），保证后端鉴权即时生效。 |
| **P0-5** | **前端：侧边栏动态渲染（MainLayout 改造）** | ① 删除 `items` 硬编码数组，改为由 `GET /api/menu/my` 返回的菜单树渲染；② 支持目录嵌套（`children` → Ant Design Menu 子菜单）；③ 图标通过 `icon` 字符串映射到前端图标组件；④ 菜单点击按 `path` 路由跳转（含 `/dashboard/resume` 微前端入口），选中态按 `pathname` 前缀匹配；⑤ **接口失败降级**：请求异常时回退渲染 5 个业务菜单，保证主流程可用；⑥ 加载中不闪烁（骨架或延迟渲染）。 |
| **P0-6** | **前端：权限工具与全局单例扩展** | ① `lib/app-config.ts` 的单例扩展为 `{ roles, permissions, menus, configs, loadedAt }`；② 新增 `hasPermission(code)` 工具，admin 恒返回 `true`，无缓存时保守返回 `false`；③ 退出登录时 `clearAppConfig()` 一并清空 permissions/menus，防止越权残留；④ 保留 `isAdmin()` 向后兼容。 |
| **P0-7** | **「系统设置」目录改造 + 基础配置平移** | ① 新增目录路由 `/dashboard/system/*`；② 原配置中心页面平移为 `/dashboard/system/config`，**功能与交互完全不变**；③ 旧路径 `/dashboard/settings` 保留并重定向到新路径，避免书签失效；④ 侧边栏「系统设置」显示为可展开目录，下辖基础配置/菜单管理/角色管理/用户管理 4 项。 |
| **P0-8** | **菜单管理页 `/dashboard/system/menu`** | ① 树形表格展示全量菜单，列：菜单名称 / 类型(Tag：目录/菜单/按钮) / 权限码 / 路由 / 图标 / 排序 / 状态 / 操作；② 支持「新增子项」在任意层级新增，类型可选目录/菜单/按钮；③ 支持编辑（父级、名称、权限码、路由、图标、排序、显示、状态）；④ 支持删除；⑤ **选择 button 类型时隐藏「路由/图标/显示」字段**，只保留父级+名称+权限码+排序；⑥ 权限码输入框实时提示命名规范（正则 + 示例）；⑦ 所有写操作调用后端接口，成功后刷新树。 |
| **P0-9** | **角色管理页 `/dashboard/system/role`** | ① 角色列表：角色名 / code / 描述 / 关联用户数 / 操作；② 支持新增、编辑（名称、code、描述）、删除；③ 提供「分配权限」弹窗：以可勾选树展示全量菜单（含 button），勾选即授权，保存调用绑定接口；④ **admin 行特殊处理**：权限列展示「全部权限（不可编辑）」标签，编辑/删除/分配权限按钮置灰，hover 提示「系统内置角色，不可修改」；⑤ 删除角色前若仍有关联用户，拦截并提示先解绑（或二次确认后解绑）。 |
| **P0-10** | **用户管理页 `/dashboard/system/user`** | ① 用户列表：邮箱 / 昵称 / 当前角色(Tag) / 账号状态(Tag) / 注册时间 / 操作；② 支持「分配角色」：多选角色，保存后调用后端接口；③ 支持「停用/启用」账号，带二次确认；④ **不允许停用/删除当前登录的自己**；⑤ 空状态、加载态、错误提示齐全。 |
| **P0-11** | **停用用户能力（User.status）** | ① `User` 表新增 `status` 字段（默认 `active`，可为 `disabled`）；② **登录时校验**：`status = disabled` 的用户即使密码正确也拒绝登录，返回明确文案「账号已被停用，请联系管理员」；③ 用户管理页可切换状态；④ 迁移后存量用户全部为 `active`，不影响现有登录。 |
| **P0-12** | **admin 角色保护（后端强制）** | ① 尝试修改 admin 角色的菜单绑定 → 后端返回 400/403 并提示「管理员角色权限不可修改」；② 尝试删除 admin 角色 → 后端拒绝；③ admin 用户鉴权时短路放行，**天然不受 RoleMenu 影响**；④ 前端 UI 与后端行为一致（前端置灰 + 后端兜底），二者不可只做其一。 |
| **P0-13** | **权限校验为安全边界（口径落地）** | ① 所有菜单/角色/用户/配置的**写接口**均挂载 `requirePermission`（配置写接口由 `requireRole(admin)` 升级为权限码校验）；② 未授权用户直接 `curl` 管理接口 → 403；③ 前端菜单隐藏仅是体验优化，**不得作为唯一控制手段**；④ 文案口径：权限变更后，**后端鉴权实时生效**，**前端菜单/按钮需重新登录后刷新**（前端不做实时推送）。 |

### 3.2 P1（Should have）

| ID | 需求 | 验收标准 |
|---|---|---|
| **P1-1** | 删除前置校验 | 删除菜单时若存在子节点 → 拦截并提示「请先删除子菜单」；删除角色时若仍被用户引用 → 提示关联用户数并拦截。 |
| **P1-2** | 权限码唯一性与命名规范校验 | 后端校验：权限码全局唯一，不符合规范（非 `小写字母/数字/:/-/_`、不以字母开头）返回 400 并给出可读提示；菜单 code 与权限码均纳入唯一性检查。 |
| **P1-3** | 无权限访问的兜底页 | 前端直接输入无权限 URL（如普通用户访问 `/dashboard/system/role`）→ 展示 403 提示页或重定向工作台，并提示「无访问权限，请联系管理员」；不出现白屏/报错。 |
| **P1-4** | 已登录用户被停用后强制下线 | 鉴权链路校验 `User.status`，被停用用户的后续请求返回 401（前端拦截后跳登录页并提示「账号已被停用」），不必等 token 过期。 |
| **P1-5** | 图标选择器 | 菜单管理表单中 `icon` 提供下拉选择（预置常用 Ant Design 图标 + 预览），避免手填错值导致图标缺失。 |
| **P1-6** | 操作审计字段 | 菜单/角色/用户角色变更记录 `updatedBy`（操作人 userId）与 `updatedAt`，列表或详情可见「最后修改人/时间」。 |
| **P1-7** | 菜单/角色启停 | 菜单支持 `status` 启停，停用后对所有角色不可见且不返回；角色支持启停，停用角色不参与鉴权（等价无此角色）。 |
| **P1-8** | 用户列表分页与搜索 | 支持按邮箱/昵称关键字搜索 + 分页（默认 10/页），用户量大时可用。 |
| **P1-9** | 按钮级权限落地示例 | 用户管理页「分配角色」按钮受 `system:user:grant` 控制、配置页保存按钮受 `system:config:update` 控制，作为全站按钮级权限的参考实现。 |

### 3.3 P2（Could have）

| ID | 需求 | 说明 |
|---|---|---|
| **P2-1** | 角色复制 | 以现有角色为模板复制权限，快速创建相似角色。 |
| **P2-2** | 菜单拖拽排序 | 树表拖拽调整 `sort` 与父级，替代手填数字。 |
| **P2-3** | 权限变更实时生效 | 通过 SSE/WebSocket 推送权限变更，免重新登录（本期已明确不做，列为演进方向）。 |
| **P2-4** | 变更历史与回滚 | 记录角色权限/菜单变更快照，支持回滚。 |
| **P2-5** | 数据行级权限 | 如「部门主管只能看本部门用户」，本期不做，模型预留扩展位。 |
| **P2-6** | 移动端侧边栏目录折叠优化 | 小屏下目录层级与折叠态体验优化。 |

### 3.4 菜单与权限码清单（种子数据基线，P0-2 的验收依据）

**权限码命名规范**：`模块[:资源][:动作]`，全小写，分隔符 `:`；目录级为模块名，菜单级为「模块:资源」，按钮级为「模块:资源:动作」。示例：`system`、`system:role`、`system:role:create`、`system:user:grant`。

| 层级 | 类型 | 名称 | code / 权限码 | 路由 | 备注 |
|---|---|---|---|---|---|
| 1 | menu | 工作台 | `dashboard` | `/dashboard` | 业务菜单，绑 `user` |
| 1 | menu | 职位发现 | `jobs` | `/dashboard/jobs` | 业务菜单，绑 `user` |
| 1 | menu | 简历优化 | `resume` | `/dashboard/resume` | 业务菜单（qiankun 子应用），绑 `user` |
| 1 | menu | 个人中心 | `profile` | `/dashboard/profile` | 业务菜单，绑 `user` |
| 1 | menu | 决策历史 | `history` | `/dashboard/history` | 业务菜单，绑 `user` |
| 1 | catalog | 系统设置 | `system` | — | 目录，仅 admin |
| 2 | menu | 基础配置 | `system:config` | `/dashboard/system/config` | 原配置中心平移 |
| 2 | menu | 菜单管理 | `system:menu` | `/dashboard/system/menu` | 新增 |
| 2 | menu | 角色管理 | `system:role` | `/dashboard/system/role` | 新增 |
| 2 | menu | 用户管理 | `system:user` | `/dashboard/system/user` | 新增（主理人补充） |
| 3 | button | 保存配置 | `system:config:update` | — | 配置写/恢复 |
| 3 | button | 新增菜单 | `system:menu:create` | — | |
| 3 | button | 编辑菜单 | `system:menu:update` | — | |
| 3 | button | 删除菜单 | `system:menu:delete` | — | |
| 3 | button | 新增角色 | `system:role:create` | — | |
| 3 | button | 编辑角色 | `system:role:update` | — | |
| 3 | button | 删除角色 | `system:role:delete` | — | |
| 3 | button | 分配权限 | `system:role:grant` | — | 角色-菜单绑定 |
| 3 | button | 分配角色 | `system:user:grant` | — | 用户-角色绑定 |
| 3 | button | 停用用户 | `system:user:disable` | — | |

> `admin` 角色不写 RoleMenu 绑定记录，鉴权时短路返回全部权限；`user` 角色绑定 5 个业务菜单。

---

## 4. UI 设计稿

整体原则：全站沿用 Ant Design 6 + Tailwind 4 现有风格（圆角 12、主色 `#3b82f6`、卡片 + 表格 + 弹窗），页面结构与配置中心设置页保持一致的头部（标题 + 说明 + 操作按钮）与动效，降低认知成本。

### 4.1 侧边栏与「系统设置」目录（MainLayout 改造）

```
┌──────────────────────────┐
│  ⚡ CareerAI              │   ← 品牌区（不变）
├──────────────────────────┤
│  ▣ 工作台                 │   ← 后端返回的菜单树，按 sort 渲染
│  ▣ 职位发现               │
│  ▣ 简历优化               │
│  ▣ 个人中心               │
│  ▣ 决策历史               │
│  ▾ 系统设置        ← 目录  │   ← 仅拥有该目录权限的角色可见（admin）
│      · 基础配置           │
│      · 菜单管理           │
│      · 角色管理           │
│      · 用户管理           │
└──────────────────────────┘
```

**交互说明**
- 菜单数据来源：登录后调用 `GET /api/menu/my`，写入 `window.__APP_CONFIG__`；`MainLayout` 直接消费该单例。
- 目录（catalog）：渲染为可展开父菜单，点击父标题仅展开/收起，不跳转。
- 菜单（menu）：点击按 `path` 跳转；选中态用 `pathname` 前缀匹配（保证 `/dashboard/system/*` 子路由下目录高亮）。
- 图标：接口返回字符串（如 `dashboard`/`setting`/`team`），前端维护「字符串 → 图标组件」映射表，未知图标降级为默认图标。
- 空菜单降级：接口失败或返回空数组时，回退渲染 5 个业务菜单并提示「菜单加载失败，已展示默认菜单」。

### 4.2 菜单管理页 `/dashboard/system/menu`

```
┌──────────────────────────────────────────────────────────────────────┐
│  ⚙ 菜单管理                                        [+ 新增菜单] [刷新] │
│  维护菜单树（目录/菜单/按钮），控制侧边栏展示与按钮级权限              │
├──────────────────────────────────────────────────────────────────────┤
│ 菜单名称       类型   权限码                 路由                操作   │
│ ▾ 工作台       菜单   dashboard             /dashboard     编辑 删除   │
│ ▾ 系统设置     目录   system                —           +子项 编辑 删除 │
│   ├ 基础配置   菜单   system:config         /dashboard/..  编辑 删除   │
│   ├ 菜单管理   菜单   system:menu           /dashboard/..  编辑 删除   │
│   ├ 角色管理   菜单   system:role           /dashboard/..  编辑 删除   │
│   └ 用户管理   菜单   system:user           /dashboard/..  编辑 删除   │
└──────────────────────────────────────────────────────────────────────┘
```

**新增/编辑弹窗**

```
┌──────────── 编辑菜单 ─────────────┐
│ 父级菜单   [ 系统设置 ▾ ]          │  ← 树形选择器，顶级为「根」
│ 菜单类型   ( ) 目录 (•) 菜单 ( ) 按钮 │  ← Radio
│ 菜单名称   [ 角色管理            ]  │
│ 权限码     [ system:role        ]  │  ← 提示：模块[:资源][:动作]，全小写
│ 路由路径   [ /dashboard/system/role ]│  ← button 类型隐藏
│ 图标       [ team ▾ ]              │  ← button 类型隐藏
│ 排序       [ 20 ]                  │
│ 显示在菜单 (•) 是 ( ) 否            │  ← button 类型隐藏
│ 状态       (•) 启用 ( ) 停用        │
│                       [取消] [保存] │
└────────────────────────────────────┘
```

**关键交互**
1. 类型切换为「按钮」时，路由/图标/显示三项**立即隐藏并清空**，仅保留父级+名称+权限码+排序。
2. 权限码输入实时校验：不符规范标红并提示正确示例；提交前做唯一性校验。
3. 「新增子项」自动把当前行设为父级，快捷建树。
4. 删除含子节点的菜单 → 弹窗拒绝并提示先删子节点。

### 4.3 角色管理页 `/dashboard/system/role`

```
┌──────────────────────────────────────────────────────────────┐
│  👥 角色管理                                  [+ 新增角色] [刷新] │
│  维护角色并为其分配菜单/按钮权限                                │
├──────────────────────────────────────────────────────────────┤
│ 角色名称   标识码   描述            用户数  权限    操作         │
│ 管理员     admin    系统管理员        1    全部权限  🔒 不可修改  │
│ 普通用户   user     默认角色          12   5 项菜单  分配权限 编辑 删除 │
└──────────────────────────────────────────────────────────────┘
```

**「分配权限」弹窗（核心交互）**

```
┌──────────── 分配权限 · 普通用户 ────────────┐
│  ⓘ 勾选后该角色可访问对应菜单与按钮          │
│  ☑ 工作台                                  │
│  ☑ 职位发现                                │
│  ☑ 简历优化                                │
│  ☑ 个人中心                                │
│  ☑ 决策历史                                │
│  ☐ 系统设置                                │
│    ☐ 基础配置      ☐ 保存配置               │
│    ☐ 菜单管理      ☐ 新增 ☐ 编辑 ☐ 删除     │
│    ☐ 角色管理      ☐ 新增 ☐ 编辑 ☐ 删除 ☐ 分配权限│
│    ☐ 用户管理      ☐ 分配角色 ☐ 停用用户     │
│                          [取消] [保存]      │
└─────────────────────────────────────────────┘
```

**关键交互**
1. 可勾选树展示全量菜单（三层），父子联动；保存时提交 `roleId + menuIds[]`。
2. `admin` 行：权限列显示 `全部权限` 标签，`分配权限/编辑/删除` 按钮置灰 + Tooltip「系统内置角色，权限不可修改、角色不可删除」。
3. 删除角色时若 `用户数 > 0`，弹窗提示「该角色下仍有 N 个用户，请先调整后再删除」。
4. 保存权限后顶部 `message.success("权限已保存，将在用户重新登录后生效")`。

### 4.4 用户管理页 `/dashboard/system/user`

```
┌───────────────────────────────────────────────────────────────────┐
│  👤 用户管理                                        [刷新] [搜索框 🔍] │
│  为用户分配角色、停用/启用账号                                       │
├───────────────────────────────────────────────────────────────────┤
│ 邮箱                 昵称    角色          状态     注册时间   操作    │
│ admin@example.com    管理员  [管理员]       ● 正常   2025-01-01 分配角色 停用│
│ user@example.com     求职者  [普通用户]     ● 正常   2025-02-01 分配角色 停用│
│ leave@example.com    —       [普通用户]     ○ 已停用 2025-03-01 分配角色 启用│
└───────────────────────────────────────────────────────────────────┘
```

**「分配角色」弹窗**
- 表单：用户邮箱（只读）+ 角色多选（`Select mode="multiple"`，选项来自角色列表，展示「角色名（code）」）+ 保存。
- 保存后提示「已保存，将在该用户重新登录后生效」。

**「停用/启用」交互**
- 二次确认：「停用后该用户将无法登录，确认停用？」→ 确认后调接口并刷新。
- 当前登录的管理员自己所在行，停用按钮置灰 + Tooltip「不能停用当前登录账号」。

### 4.5 通用交互约定
- **变更生效提示**：所有影响权限的操作（角色权限、用户角色、菜单启停）成功后统一提示「将在用户重新登录后生效」。
- **后端兜底提示**：任何接口返回 403 时前端统一弹出「无权限执行此操作」并保留当前页面，不跳转、不白屏。
- **加载与空态**：所有表格/树使用 Skeleton 或 Spin；空数据显示 Empty + 引导文案（如「暂无角色，点击右上角新增」）。

---

## 5. 待确认问题

| # | 问题 | 建议方案（待主理人/用户确认） |
|---|---|---|
| Q1 | 角色 `code` 创建后是否允许修改？ | **建议不可改**（业务代码与权限码强依赖 code），仅允许改名与描述；如需变更需新建角色。 |
| Q2 | 菜单删除策略：禁止删除含子节点 vs 级联删除？ | **建议禁止**（更安全、误删代价低），提示先删子节点。 |
| Q3 | 「目录」本身是否也需要权限码？ | **建议需要**（`system`），这样目录可作为整体授权单元，且便于后端对目录级入口鉴权。 |
| Q4 | 除 `admin` 外是否还需要「超管」或第二内置角色？ | 本期**只保护 admin 一个内置角色**；`user` 是否也保护待定（建议 admin/user 均不可删 code）。 |
| Q5 | 新注册用户是否自动绑定 `user` 角色？ | **建议注册时自动绑定**，否则新用户登录后侧边栏为空。需确认与现有注册流程的改动范围。 |
| Q6 | 停用用户时是否要强制踢下线（已有 token）？ | **建议 P1-4 实现**：鉴权链路校验 status，被停用即返回 401，不等 token 过期。 |
| Q7 | 旧路径 `/dashboard/settings` 的兼容期？ | 建议保留重定向，至少一个大版本后再移除。 |
| Q8 | 业务菜单（如职位发现、简历优化）是否需要按钮级权限？ | 本期**只入库菜单、不设按钮权限**，预留 `jobs:create` 等命名空间，后续按需补充。 |

---

## 附录 A：数据模型与接口契约（供架构师参考）

### A.1 数据模型（建议）

```prisma
// 菜单（目录/菜单/按钮 三类型统一建模，自引用成树）
model Menu {
  id         String   @id @default(uuid()) @map("id")
  parentId   String?  @map("parent_id")
  type       String   @map("type")            // catalog | menu | button
  code       String   @unique @map("code")    // 唯一标识 / button 即权限码
  name       String   @map("name")            // 中文名
  path       String?  @map("path")            // 路由路径（button 为空）
  component  String?  @map("component")       // 前端组件/子应用标识（可选）
  icon       String?  @map("icon")            // 图标名
  sort       Int      @default(0) @map("sort")
  visible    Boolean  @default(true) @map("visible")   // 是否显示在侧边栏
  status     String   @default("active") @map("status") // active | disabled
  createdAt  DateTime @default(now()) @map("created_at")
  updatedAt  DateTime @updatedAt @map("updated_at")

  parent     Menu?     @relation("MenuTree", fields: [parentId], references: [id])
  children   Menu[]    @relation("MenuTree")
  roles      RoleMenu[]

  @@index([parentId])
  @@map("menus")
}

model RoleMenu {
  roleId String @map("role_id")
  menuId String @map("menu_id")
  role   Role   @relation(fields: [roleId], references: [id], onDelete: Cascade)
  menu   Menu   @relation(fields: [menuId], references: [id], onDelete: Cascade)
  @@id([roleId, menuId])
  @@map("role_menus")
}

// User 增加：status String @default("active") @map("status")  // active | disabled
// Role 增加：menus RoleMenu[]
```

### A.2 接口清单（建议）

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/menu/my` | 登录 | 当前用户菜单树 + 权限码数组（admin 全量） |
| GET | `/api/menu/tree` | `system:menu` | 全量菜单树（菜单管理页） |
| POST | `/api/menu` | `system:menu:create` | 新增菜单 |
| PUT | `/api/menu/:id` | `system:menu:update` | 编辑菜单 |
| DELETE | `/api/menu/:id` | `system:menu:delete` | 删除菜单 |
| GET | `/api/role/list` | `system:role` | 角色列表（含用户数） |
| POST | `/api/role` | `system:role:create` | 新增角色 |
| PUT | `/api/role/:id` | `system:role:update` | 编辑角色（admin 拒绝） |
| DELETE | `/api/role/:id` | `system:role:delete` | 删除角色（admin 拒绝） |
| GET | `/api/role/:id/menus` | `system:role` | 角色已绑定菜单 id 列表 |
| PUT | `/api/role/:id/menus` | `system:role:grant` | 保存角色菜单绑定（admin 拒绝） |
| GET | `/api/user/list` | `system:user` | 用户列表（分页 + 关键字） |
| PUT | `/api/user/:id/roles` | `system:user:grant` | 分配角色 |
| PUT | `/api/user/:id/status` | `system:user:disable` | 停用/启用（禁止操作自己） |
| POST/PUT/DELETE | `/api/config*` | 由 `requireRole(admin)` 升级为 `system:config:update` | 配置中心写接口 |

### A.3 与现有代码的改造映射

| 文件 | 改动 |
|---|---|
| `server/prisma/schema.prisma` | 新增 Menu / RoleMenu，User 加 status，Role 加 menus 关系 |
| `server/prisma/seed-roles.ts` | 幂等写入菜单树 + 角色菜单绑定（admin 不写绑定） |
| `server/src/middleware/rbac.ts` | 新增 `getUserPermissions()`、`getUserMenuTree()`、`requirePermission()`；admin 短路 |
| `server/src/routes/`（新增） | `menu.routes.ts`、`role.routes.ts`；`config.routes.ts` 权限码升级 |
| `server/src/app.ts` | 挂载 `/api/menu`、`/api/role` |
| `my-app/lib/app-config.ts` | 单例扩展 permissions/menus；新增 `hasPermission()` |
| `my-app/api/modules/`（新增） | `menu.ts`、`role.ts`；`user.ts` 补用户管理接口 |
| `my-app/components/layout/MainLayout.tsx` | 硬编码 items → 接口驱动动态渲染 + 图标映射 + 降级 |
| `my-app/app/dashboard/system/*` | 新增目录与 4 个子页面；旧 `/dashboard/settings` 重定向 |
