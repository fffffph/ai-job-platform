/**
 * ============================================
 * 用户模块 API（User Module）
 * ============================================
 *
 * 【职责】
 * 封装所有用户资料相关的 HTTP 请求。
 * 所有需要认证的接口，Token 由 client.ts 的请求拦截器自动注入。
 *
 * 【使用示例】
 * import { getUserProfile, updateProfile } from "@/api";
 * const res = await getUserProfile();
 * if (res.success) { console.log(res.data.name); }
 */

import client from "../client";
import type {
  ApiResponse,
  UserProfile,
  UpdateProfileParams,
  ChangePasswordParams,
  AvatarResult,
  DeepSeekKeyStatus,
  DeepSeekKeyTestResult,
  SiliconFlowKeyStatus,
  SiliconFlowKeyTestResult,
  UserRolesResult,
  UserListResult,
  UserListQuery,
  AssignRolesParams,
  SetUserStatusParams,
  CreateUserParams,
  CreateUserResult,
  IdentifierCheckResult,
  IdentifierField,
  UpdateIdentifiersParams,
  UpdateIdentifiersResult,
  UpdateUserParams,
  ResetPasswordParams,
} from "../types";

// ============================================================
// API 请求函数
// ============================================================

/**
 * 获取当前用户资料
 *
 * GET /api/user/profile（需 JWT 认证）
 *
 * @returns 用户资料（不含密码）
 */
export async function getUserProfile(): Promise<ApiResponse<UserProfile>> {
  try {
    return await client.get("/api/user/profile");
  } catch (error: any) {
    return {
      success: false,
      message: error?.message || "获取用户信息失败",
      code: error?.code,
    };
  }
}

/**
 * 更新用户资料
 *
 * PUT /api/user/profile（需 JWT 认证）
 *
 * @param params - 要更新的字段（{ name?, bio? }）
 * @returns 更新后的用户资料
 */
export async function updateProfile(
  params: UpdateProfileParams
): Promise<ApiResponse<UserProfile>> {
  try {
    return await client.put("/api/user/profile", params);
  } catch (error: any) {
    return {
      success: false,
      message: error?.message || "保存失败，请稍后重试",
      code: error?.code,
    };
  }
}

/**
 * 修改密码
 *
 * PUT /api/user/password（需 JWT 认证）
 *
 * 【重要】后端改密码后会执行 tokenVersion++ 吊销该用户所有旧 Token，
 * 因此响应里会带回一个**新的 Token**，调用方必须用 setToken() 覆盖本地存储，
 * 否则用户改完密码后下一个请求就会被吊销机制踢下线。
 *
 * @param params - { oldPassword, newPassword }
 * @returns { token } —— 新的 JWT Token
 */
export async function changePassword(
  params: ChangePasswordParams
): Promise<ApiResponse<{ token: string }>> {
  try {
    return await client.put("/api/user/password", params);
  } catch (error: any) {
    return {
      success: false,
      message: error?.message || "密码修改失败",
      code: error?.code,
    };
  }
}

/**
 * 修改登录标识（邮箱 / 手机号 / 用户名）
 *
 * PUT /api/user/identifiers（需 JWT 认证）
 *
 * 【安全约束（后端强制）】
 * - 必须携带当前密码（password），否则 400 WRONG_PASSWORD；
 *   无密码账号（管理员代建 / 验证码注册）后端会跳过该校验。
 * - 三个标识至少保留一个，全空会被 400 IDENTIFIER_INVALID 拒绝；
 * - 标识被他人占用 → 409 IDENTIFIER_EXISTS（响应 message 会指明是哪个标识）。
 *
 * 【关于返回值里的 token】
 * JWT payload 里带 email，邮箱变更时后端会重签一份 Token 放在 data.token。
 * 调用方发现它存在时必须 setToken() 替换本地存储，保持 payload 与库一致。
 *
 * @param params - { password, email?, phone?, username? }（undefined = 保持原值，"" = 清空）
 * @returns { profile, token? }
 */
export async function updateIdentifiersApi(
  params: UpdateIdentifiersParams
): Promise<ApiResponse<UpdateIdentifiersResult>> {
  try {
    return await client.put("/api/user/identifiers", params);
  } catch (error) {
    // 注意：这里不写 catch (error: any)（会触发 no-explicit-any），
    // 改用「断言成最小形状」的方式安全取值
    const e = error as { message?: string; code?: string };
    return {
      success: false,
      message: e?.message || "登录标识修改失败",
      code: e?.code,
    };
  }
}

/**
 * 上传头像
 *
 * POST /api/user/avatar（需 JWT 认证）
 *
 * 前端以 multipart/form-data 格式发送，字段名为 avatar。
 * Token 和 Content-Type 由 axios 自动处理。
 *
 * @param file - 用户选择的图片文件
 * @returns { avatar: "/uploads/avatars/xxx.jpg" }
 */
export async function uploadAvatar(
  file: File
): Promise<ApiResponse<AvatarResult>> {
  try {
    const formData = new FormData();
    formData.append("avatar", file);

    return await client.post("/api/user/avatar", formData, {
      // 上传文件需要设置正确的 Content-Type（multipart/form-data）
      // axios 会自动根据 FormData 设置正确的 Content-Type 和 boundary
      headers: {
        "Content-Type": "multipart/form-data",
      },
    });
  } catch (error: any) {
    return {
      success: false,
      message: error?.message || "头像上传失败",
      code: error?.code,
    };
  }
}

// ============================================================
// DeepSeek API Key 相关 API
// ============================================================

/**
 * 获取当前用户的 DeepSeek API Key 状态（脱敏）
 *
 * GET /api/user/deepseek-key（需 JWT 认证）
 */
export async function getDeepSeekKeyStatus(): Promise<
  ApiResponse<DeepSeekKeyStatus>
> {
  try {
    return await client.get("/api/user/deepseek-key");
  } catch (error: any) {
    return {
      success: false,
      message: error?.message || "获取 API Key 状态失败",
      code: error?.code,
    };
  }
}

/**
 * 保存 DeepSeek API Key（加密存储）
 *
 * PUT /api/user/deepseek-key（需 JWT 认证）
 */
export async function saveDeepSeekKey(
  apiKey: string
): Promise<ApiResponse<DeepSeekKeyStatus>> {
  try {
    return await client.put("/api/user/deepseek-key", { apiKey });
  } catch (error: any) {
    return {
      success: false,
      message: error?.message || "保存失败，请稍后重试",
      code: error?.code,
    };
  }
}

/**
 * 删除（清空）DeepSeek API Key
 *
 * DELETE /api/user/deepseek-key（需 JWT 认证）
 */
export async function deleteDeepSeekKey(): Promise<ApiResponse<null>> {
  try {
    return await client.delete("/api/user/deepseek-key");
  } catch (error: any) {
    return {
      success: false,
      message: error?.message || "删除失败，请稍后重试",
      code: error?.code,
    };
  }
}

/**
 * 测试 DeepSeek API Key 连通性（不落库）
 *
 * POST /api/user/deepseek-key/test（需 JWT 认证）
 */
export async function testDeepSeekKey(
  apiKey: string
): Promise<ApiResponse<DeepSeekKeyTestResult>> {
  try {
    return await client.post("/api/user/deepseek-key/test", { apiKey });
  } catch (error: any) {
    return {
      success: false,
      message: error?.message || "测试失败，请稍后重试",
      code: error?.code,
    };
  }
}

// ============================================================
// SiliconFlow API Key 相关 API（与 DeepSeek Key 对称）
// ============================================================

/**
 * 获取当前用户的 SiliconFlow API Key 状态（脱敏）
 *
 * GET /api/user/siliconflow-key（需 JWT 认证）
 */
export async function getSiliconFlowKeyStatus(): Promise<
  ApiResponse<SiliconFlowKeyStatus>
> {
  try {
    return await client.get("/api/user/siliconflow-key");
  } catch (error: any) {
    return {
      success: false,
      message: error?.message || "获取 API Key 状态失败",
      code: error?.code,
    };
  }
}

/**
 * 保存 SiliconFlow API Key（加密存储）
 *
 * PUT /api/user/siliconflow-key（需 JWT 认证）
 */
export async function saveSiliconFlowKey(
  apiKey: string
): Promise<ApiResponse<SiliconFlowKeyStatus>> {
  try {
    return await client.put("/api/user/siliconflow-key", { apiKey });
  } catch (error: any) {
    return {
      success: false,
      message: error?.message || "保存失败，请稍后重试",
      code: error?.code,
    };
  }
}

/**
 * 删除（清空）SiliconFlow API Key
 *
 * DELETE /api/user/siliconflow-key（需 JWT 认证）
 */
export async function deleteSiliconFlowKey(): Promise<ApiResponse<null>> {
  try {
    return await client.delete("/api/user/siliconflow-key");
  } catch (error: any) {
    return {
      success: false,
      message: error?.message || "删除失败，请稍后重试",
      code: error?.code,
    };
  }
}

/**
 * 测试 SiliconFlow API Key 连通性（不落库）
 *
 * POST /api/user/siliconflow-key/test（需 JWT 认证）
 */
export async function testSiliconFlowKey(
  apiKey: string
): Promise<ApiResponse<SiliconFlowKeyTestResult>> {
  try {
    return await client.post("/api/user/siliconflow-key/test", { apiKey });
  } catch (error: any) {
    return {
      success: false,
      message: error?.message || "测试失败，请稍后重试",
      code: error?.code,
    };
  }
}

// ============================================================
// 角色查询（RBAC）
// ============================================================

/**
 * 获取当前用户角色代码列表（如 ["admin"] / ["user"]）。
 *
 * GET /api/user/roles（需 JWT 认证）
 *
 * 前端登录后调用一次，据此判断是否管理员、控制「系统设置」等管理入口显示。
 *
 * @returns { roles: string[] }（角色代码数组）
 */
export async function getMyRoles(): Promise<ApiResponse<UserRolesResult>> {
  try {
    return await client.get("/api/user/roles");
  } catch (error: any) {
    return {
      success: false,
      message: error?.message || "读取用户角色失败",
      code: error?.code,
    };
  }
}

// ============================================================
// 用户管理（RBAC 权限体系，管理侧）
// ============================================================

/**
 * 获取用户列表（分页 + 关键字）。
 *
 * GET /api/user/list（需 system:user）
 *
 * @param query - { keyword?, page?, pageSize? }
 * @returns 用户列表（含角色、状态、注册时间）
 */
export async function getUserListApi(
  query: UserListQuery = {}
): Promise<ApiResponse<UserListResult>> {
  try {
    return await client.get("/api/user/list", { params: query });
  } catch (error: any) {
    return {
      success: false,
      message: error?.message || "读取用户列表失败",
      code: error?.code,
    };
  }
}

/**
 * 分配用户角色（全量重写）。
 *
 * PUT /api/user/:id/roles（需 system:user:grant）
 *
 * @param userId  - 目标用户 id
 * @param params  - { roleIds: string[] }
 */
export async function assignUserRolesApi(
  userId: string,
  params: AssignRolesParams
): Promise<ApiResponse<null>> {
  try {
    return await client.put(`/api/user/${userId}/roles`, params);
  } catch (error: any) {
    return {
      success: false,
      message: error?.message || "分配角色失败",
      code: error?.code,
    };
  }
}

/**
 * 设置用户账号状态（停用 / 启用）。
 *
 * PUT /api/user/:id/status（需 system:user:disable；禁止操作自己）
 *
 * @param userId - 目标用户 id
 * @param params - { status: 'active' | 'disabled' }
 */
export async function setUserStatusApi(
  userId: string,
  params: SetUserStatusParams
): Promise<ApiResponse<null>> {
  try {
    return await client.put(`/api/user/${userId}/status`, params);
  } catch (error: any) {
    return {
      success: false,
      message: error?.message || "设置账号状态失败",
      code: error?.code,
    };
  }
}

// ============================================================
// 新增用户（B-P0）
// ============================================================

/**
 * 新增用户。
 *
 * POST /api/user（需 system:user:create）
 *
 * 【说明】
 * - email / phone / username 三个登录标识至少填一个（后端统一校验格式与唯一性）；
 * - passwordMode 为 "default" 时后端取配置项 auth.user.default_password，
 *   为 "custom" 时使用传入的 password；
 * - roleIds 为空时后端自动绑定默认 user 角色；
 * - 含 admin 角色时后端会校验操作者本身是否为管理员（提权防护）。
 *
 * @param params - 新增用户入参
 * @returns 新用户公开信息（不含密码哈希）
 */
export async function createUserApi(
  params: CreateUserParams
): Promise<ApiResponse<CreateUserResult>> {
  try {
    return await client.post("/api/user", params);
  } catch (error: any) {
    return {
      success: false,
      message: error?.message || "创建用户失败",
      code: error?.code,
    };
  }
}

/**
 * 登录标识唯一性即时校验。
 *
 * GET /api/user/check-identity（需 system:user）
 *
 * 用于「新增用户」表单在输入框失焦时提前提示「该邮箱已被占用」。
 *
 * @param field         - email | phone | username
 * @param value         - 用户输入的值
 * @param excludeUserId - 排除的用户 id（编辑场景传目标用户自己，避免误判自己占用）
 */
export async function checkIdentityApi(
  field: IdentifierField,
  value: string,
  excludeUserId?: string
): Promise<ApiResponse<IdentifierCheckResult>> {
  try {
    return await client.get("/api/user/check-identity", {
      params: { field, value, excludeUserId },
    });
  } catch (error: any) {
    return {
      success: false,
      message: error?.message || "校验失败",
      code: error?.code,
    };
  }
}

// ============================================================
// 编辑用户 / 重置密码 / 删除（B-P1）
// ============================================================

/**
 * 编辑用户资料（昵称 / 备注 / 三标识 / 强制改密开关）。
 *
 * PUT /api/user/:id（需 system:user:update）
 *
 * 三标识按 PATCH 语义：undefined = 保持原值，"" 或 null = 清空。
 * 后端会排除自己做唯一性校验，并保证至少保留一个标识。
 *
 * @param userId - 目标用户 id
 * @param params - 编辑入参
 */
export async function updateUserApi(
  userId: string,
  params: UpdateUserParams
): Promise<ApiResponse<null>> {
  try {
    return await client.put(`/api/user/${userId}`, params);
  } catch (error: any) {
    return {
      success: false,
      message: error?.message || "保存失败，请稍后重试",
      code: error?.code,
    };
  }
}

/**
 * 重置用户密码（系统默认密码 / 自定义）。
 *
 * PUT /api/user/:id/reset-password（需 system:user:reset-password）
 *
 * 重置后该账号所有旧 Token 被吊销（下次登录会被踢下线），
 * 并被强制下次登录改密（mustChangePassword = true）。
 *
 * @param userId - 目标用户 id
 * @param params - { passwordMode, password? }
 */
export async function resetUserPasswordApi(
  userId: string,
  params: ResetPasswordParams
): Promise<ApiResponse<null>> {
  try {
    return await client.put(`/api/user/${userId}/reset-password`, params);
  } catch (error: any) {
    return {
      success: false,
      message: error?.message || "重置密码失败",
      code: error?.code,
    };
  }
}

/**
 * 删除用户（软删除）。
 *
 * DELETE /api/user/:id（需 system:user:delete）
 *
 * 后端禁止删除当前登录的自己，也禁止删除最后一个管理员。
 *
 * @param userId - 目标用户 id
 */
export async function deleteUserApi(
  userId: string
): Promise<ApiResponse<null>> {
  try {
    return await client.delete(`/api/user/${userId}`);
  } catch (error: any) {
    return {
      success: false,
      message: error?.message || "删除用户失败",
      code: error?.code,
    };
  }
}
