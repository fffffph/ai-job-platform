/**
 * ============================================
 * 全局类型定义
 * ============================================
 *
 * 统一管理项目中所有 TypeScript 类型定义，
 * 确保请求/响应数据结构一致，降低维护成本。
 */

// ========== 认证相关类型 ==========

/**
 * 注册请求体
 *
 * 客户端 POST /api/auth/register 时发送的 JSON 数据。
 * email 与 password 必填，username 作为登录账号（可选，不填则只能用邮箱登录）。
 *
 * 【username 与 name 的区别（务必分清）】
 * - username：登录标识（账号），唯一、只能字母数字下划线中划线、禁止纯数字；
 * - name    ：昵称，仅展示，可重复、可含中文。
 * 历史遗留：旧版注册页把「用户名」输入框映射给了 name，导致其实没有账号登录能力。
 */
export interface RegisterRequest {
  /**
   * 邮箱地址，登录标识之一（可选）。
   * 三标识（email / phone / username）至少要有一个，否则无法登录；
   * 具体由 Service 层 normalizeAndValidateIdentifiers 统一把关。
   */
  email?: string;
  /** 明文密码，服务端收到后通过 bcrypt 加密存储 */
  password: string;
  /** 用户名 / 账号，作为登录标识之一（可选） */
  username?: string;
  /** 用户昵称（可选，仅展示用） */
  name?: string;
}

/**
 * 登录请求体
 *
 * 客户端 POST /api/auth/login 时发送的 JSON 数据。
 *
 * 【统一登录入口】
 * 推荐传 `identifier`（一个输入框，邮箱 / 手机号 / 用户名都能填），
 * 由服务端 resolveIdentifier 判定具体类型。
 * 兼容旧版前端传 `email`：identifier 缺省时回退取 email，保证平滑升级。
 */
export interface LoginRequest {
  /** 统一账号：邮箱 / 手机号 / 用户名（推荐） */
  identifier?: string;
  /** 兼容旧版前端的邮箱字段（identifier 缺省时使用） */
  email?: string;
  /** 明文密码，服务端通过 bcrypt.compare() 比对数据库中的密文 */
  password: string;
}

// ========== 统一 API 响应类型 ==========

/**
 * 成功响应
 *
 * 所有成功（2xx）的 API 响应都使用此格式。
 * data 字段类型根据具体接口变化。
 */
export interface ApiSuccessResponse<T = unknown> {
  /** 固定为 true，表示请求成功 */
  success: true;
  /** 给用户的友好提示信息 */
  message: string;
  /** 业务数据，类型由泛型 T 决定 */
  data: T;
}

/**
 * 失败响应
 *
 * 所有失败（4xx/5xx）的 API 响应都使用此格式。
 * error 字段包含具体的错误详情。
 */
export interface ApiErrorResponse {
  /** 固定为 false，表示请求失败 */
  success: false;
  /** 给用户的错误提示信息 */
  message: string;
  /** 详细错误信息（开发环境返回，生产环境可隐藏） */
  error?: string;
  /** 错误码，便于前端根据不同的错误码做不同处理 */
  code?: string;
}

/**
 * 认证成功响应数据
 *
 * 登录/注册成功后返回的数据结构，
 * 包含 JWT token 和用户基本信息。
 */
export interface AuthResponseData {
  /** JWT 访问令牌，后续请求需在 Authorization header 中携带 */
  token: string;
  /** 用户信息（不包含密码） */
  user: {
    id: string;
    /** 邮箱（可空：可能只用手机号/用户名注册） */
    email: string | null;
    /** 手机号（可空） */
    phone: string | null;
    /** 用户名 / 账号（可空） */
    username: string | null;
    name: string | null;
    avatar: string | null;
    bio: string | null;
    /** 是否需要强制修改密码（管理员代建账号时为 true） */
    mustChangePassword: boolean;
    createdAt: Date;
  };
}

// ========== 用户资料相关类型 ==========

/** 更新用户资料请求体 */
export interface UpdateProfileRequest {
  /** 用户昵称 */
  name?: string;
  /** 个人简介 */
  bio?: string;
}

/** 修改密码请求体 */
export interface ChangePasswordRequest {
  /** 旧密码 */
  oldPassword: string;
  /** 新密码 */
  newPassword: string;
}

// ========== RBAC 权限体系：菜单 / 角色 / 用户管理 共享类型 ==========

/** 菜单节点类型：catalog（目录）| menu（菜单）| button（按钮） */
export type MenuType = "catalog" | "menu" | "button";

/** 菜单/角色启用状态 */
export type MenuStatus = "active" | "disabled";

/** 用户账号状态 */
export type UserStatus = "active" | "disabled";

/**
 * 菜单树节点（接口返回给前端的结构）。
 *
 * 用于 GET /api/menu/my：catalog + menu 两级（或按实际层级），
 * 已按 sort 升序，不含 button；path/icon 为空时前端做兜底。
 */
export interface MenuTreeNode {
  /** 菜单 id */
  id: string;
  /** 权限码 / 唯一标识 */
  code: string;
  /** 菜单名称（中文） */
  name: string;
  /** 路由路径（catalog 为 null） */
  path: string | null;
  /** 图标名（前端映射到图标组件，可为 null） */
  icon: string | null;
  /** 同级排序值（升序） */
  sort: number;
  /** 子菜单 */
  children?: MenuTreeNode[];
}

/**
 * 新增菜单入参（POST /api/menu）。
 */
export interface CreateMenuInput {
  /** 父级菜单 id，null 表示顶级 */
  parentId: string | null;
  /** 节点类型 */
  type: MenuType;
  /** 权限码（唯一，需符合命名规范） */
  code: string;
  /** 菜单名称 */
  name: string;
  /** 路由路径（button 忽略） */
  path?: string | null;
  /** 组件/子应用标识（预留，可选） */
  component?: string | null;
  /** 图标名（button 忽略） */
  icon?: string | null;
  /** 排序值 */
  sort?: number;
  /** 是否显示在侧边栏（button 忽略） */
  visible?: boolean;
  /** 启用状态 */
  status?: MenuStatus;
}

/**
 * 编辑菜单入参（PUT /api/menu/:id）。
 *
 * 【注意】依据主理人拍板 A2：菜单 code 创建后不可修改，
 * 若请求携带与现有值不同的 code，服务层将拒绝并返回 400。
 */
export type UpdateMenuInput = Partial<CreateMenuInput>;

/**
 * 角色列表项（GET /api/role/list）。
 */
export interface RoleListItem {
  /** 角色 id */
  id: string;
  /** 角色代码 */
  code: string;
  /** 角色名称 */
  name: string;
  /** 角色描述 */
  description: string | null;
  /** 是否系统内置角色（admin/user=true，不可删除） */
  isSystem: boolean;
  /** 关联用户数 */
  userCount: number;
  /** 绑定菜单数；admin 为 null（表示"全部权限"） */
  menuCount: number | null;
}

/**
 * 管理侧用户列表项（GET /api/user/list）。
 */
export interface AdminUserItem {
  /** 用户 id */
  id: string;
  /** 邮箱（登录标识之一，可空） */
  email: string | null;
  /** 手机号（登录标识之一，可空） */
  phone: string | null;
  /** 用户名 / 账号（登录标识之一，可空） */
  username: string | null;
  /** 昵称（可空） */
  name: string | null;
  /** 该用户的角色列表 */
  roles: { id: string; code: string; name: string }[];
  /** 账号状态 */
  status: UserStatus;
  /** 是否需要强制修改密码 */
  mustChangePassword: boolean;
  /** 最后登录时间（ISO 字符串，从未登录为 null） */
  lastLoginAt: string | null;
  /** 注册时间（ISO 字符串） */
  createdAt: string;
}

/**
 * 管理员新增用户入参（POST /api/user）。
 *
 * 【三个登录标识至少填一个】，由 identifier.ts 的
 * normalizeAndValidateIdentifiers 统一校验，不走数据库兜底。
 */
export interface CreateUserInput {
  /** 邮箱（登录标识，可选） */
  email?: string | null;
  /** 手机号（登录标识，可选） */
  phone?: string | null;
  /** 用户名（登录标识，可选） */
  username?: string | null;
  /** 昵称（可选） */
  name?: string | null;
  /** 管理员备注（可选） */
  remark?: string | null;
  /**
   * 密码来源：
   * - "default"：使用系统配置项 auth.user.default_password 里的默认密码（默认）
   * - "custom" ：使用请求传入的 password
   */
  passwordMode?: "default" | "custom";
  /** 密码来源为 custom 时的明文密码 */
  password?: string | null;
  /** 分配的角色 id 数组（为空则默认绑定 user 角色） */
  roleIds?: string[];
  /** 账号状态，默认 active */
  status?: UserStatus;
  /** 是否要求首次登录强制改密，默认 true */
  mustChangePassword?: boolean;
}

/**
 * 新增用户返回数据（POST /api/user）。
 *
 * 【安全约定】
 * 绝不返回 password 哈希。仅当使用系统默认密码时，
 * 返回 `usedDefaultPassword: true` 提示管理员默认密码来自配置项，
 * 便于其告知用户或提醒用户尽快改密。
 */
export interface CreateUserResult {
  /** 新用户 id */
  id: string;
  /** 邮箱 */
  email: string | null;
  /** 手机号 */
  phone: string | null;
  /** 用户名 */
  username: string | null;
  /** 昵称 */
  name: string | null;
  /** 账号状态 */
  status: UserStatus;
  /** 绑定的角色列表 */
  roles: { id: string; code: string; name: string }[];
  /** 是否使用了系统默认密码（true 时前端提示「密码来自系统配置」） */
  usedDefaultPassword: boolean;
  /** 是否需要首次登录强制改密 */
  mustChangePassword: boolean;
}

/** 标识唯一性校验结果（GET /api/user/check-identity） */
export interface IdentifierCheckResult {
  /** 该标识是否已被占用 */
  exists: boolean;
  /** 被占用时给出是哪个字段冲突 */
  conflictField?: "email" | "phone" | "username";
}
