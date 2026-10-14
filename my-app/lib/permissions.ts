/**
 * ============================================
 * 前端权限码常量（RBAC 权限体系）
 * ============================================
 *
 * 【职责】
 * 集中定义前端使用的权限码常量，供按钮级权限控制（hasPermission）引用。
 * 业务代码禁止硬编码权限码字符串，一律引用本常量。
 *
 * 【单一事实源】
 * 后端对应 `my-app/server/src/middleware/rbac.ts` 的 PERMISSION_CODES，
 * 两者值必须保持一致；新增权限码时两处同步更新。
 */

/**
 * 权限码常量（与后端 PERMISSION_CODES 一致）
 */
export const PERMISSIONS = {
  /** 系统设置目录 */
  SYSTEM: "system",
  /** 基础配置菜单 */
  SYSTEM_CONFIG: "system:config",
  /** 菜单管理菜单 */
  SYSTEM_MENU: "system:menu",
  /** 角色管理菜单 */
  SYSTEM_ROLE: "system:role",
  /** 用户管理菜单 */
  SYSTEM_USER: "system:user",
  /** 保存/恢复配置（按钮） */
  CONFIG_UPDATE: "system:config:update",
  /** 新增菜单（按钮） */
  MENU_CREATE: "system:menu:create",
  /** 编辑菜单（按钮） */
  MENU_UPDATE: "system:menu:update",
  /** 删除菜单（按钮） */
  MENU_DELETE: "system:menu:delete",
  /** 新增角色（按钮） */
  ROLE_CREATE: "system:role:create",
  /** 编辑角色（按钮） */
  ROLE_UPDATE: "system:role:update",
  /** 删除角色（按钮） */
  ROLE_DELETE: "system:role:delete",
  /** 分配权限（按钮） */
  ROLE_GRANT: "system:role:grant",
  /** 分配角色（按钮） */
  USER_GRANT: "system:user:grant",
  /** 停用用户（按钮） */
  USER_DISABLE: "system:user:disable",
} as const;

/**
 * 权限码命名规范正则（与后端一致）。
 *
 * 规则：小写字母开头，仅含小写字母/数字/:/-/_。
 */
export const PERMISSION_CODE_PATTERN = /^[a-z][a-z0-9:_-]*$/;

/** 权限码命名规范提示文案（表单 extra 提示用） */
export const PERMISSION_CODE_HINT =
  "命名规范：模块[:资源][:动作]，全小写，分隔符用冒号；如 system:role:grant";
