/**
 * ============================================
 * 用户服务模块（User Service）
 * ============================================
 *
 * 【职责】
 * 封装用户资料相关的业务逻辑：
 * - 查询用户信息（不含密码）
 * - 更新用户资料（name、bio）
 * - 修改密码（旧密码验证 + 新密码加密）
 * - 更新头像
 */

import bcrypt from "bcrypt";
import prisma from "../lib/prisma.js";

const BCRYPT_SALT_ROUNDS = parseInt(
  process.env.BCRYPT_SALT_ROUNDS || "10",
  10
);

// ========== 返回类型定义 ==========

/** 公开的用户信息（不含密码） */
export interface UserProfile {
  id: string;
  email: string;
  name: string | null;
  avatar: string | null;
  bio: string | null;
  createdAt: Date;
}

// ========== 业务函数 ==========

/**
 * 获取用户资料
 *
 * 使用 Prisma select 确保 password 字段永远不会返回给客户端。
 *
 * @param userId - 用户 ID（来自 JWT Token 的 sub 字段）
 * @returns 用户公开信息
 * @throws 用户不存在时抛出错误
 */
export async function getProfile(userId: string): Promise<UserProfile> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    // 显式选择返回字段，确保 password 不被包含
    select: {
      id: true,
      email: true,
      name: true,
      avatar: true,
      bio: true,
      createdAt: true,
    },
  });

  if (!user) {
    throw new Error("用户不存在");
  }

  return user;
}

/**
 * 更新用户资料
 *
 * 仅允许更新 name 和 bio 字段。
 * email 不可修改（通过后端逻辑保证，不依赖前端传来的 email 值）。
 *
 * @param userId  - 用户 ID
 * @param updates - 要更新的字段（{ name?, bio? }）
 * @returns 更新后的用户信息
 */
export async function updateProfile(
  userId: string,
  updates: { name?: string; bio?: string }
): Promise<UserProfile> {
  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      // 只更新传入的字段，未传入的保持原值
      ...(updates.name !== undefined ? { name: updates.name } : {}),
      ...(updates.bio !== undefined ? { bio: updates.bio } : {}),
    },
    select: {
      id: true,
      email: true,
      name: true,
      avatar: true,
      bio: true,
      createdAt: true,
    },
  });

  return user;
}

/**
 * 修改密码
 *
 * 【安全流程】
 * 1. 根据用户 ID 查询当前密码密文
 * 2. 用 bcrypt.compare() 验证旧密码是否正确
 * 3. 用 bcrypt.hash() 加密新密码
 * 4. 更新数据库
 *
 * @param userId      - 用户 ID
 * @param oldPassword - 旧密码明文
 * @param newPassword - 新密码明文
 * @throws 旧密码不正确时抛出
 */
export async function changePassword(
  userId: string,
  oldPassword: string,
  newPassword: string
): Promise<void> {
  // ---------- 步骤 1：查询当前密码 ----------
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { password: true }, // 只取密码字段
  });

  if (!user) {
    throw new Error("用户不存在");
  }

  // ---------- 步骤 2：验证旧密码 ----------
  const isOldPasswordValid = await bcrypt.compare(
    oldPassword,
    user.password
  );

  if (!isOldPasswordValid) {
    throw new Error("旧密码不正确");
  }

  // ---------- 步骤 3：加密新密码并更新 ----------
  const hashedNewPassword = await bcrypt.hash(
    newPassword,
    BCRYPT_SALT_ROUNDS
  );

  await prisma.user.update({
    where: { id: userId },
    data: { password: hashedNewPassword },
  });
}

/**
 * 更新用户头像 URL
 *
 * 头像 URL 由文件上传端点（POST /api/user/avatar）生成。
 * 此函数仅负责将 URL 写入数据库。
 *
 * @param userId    - 用户 ID
 * @param avatarUrl - 头像的相对路径 / URL
 * @returns 更新后的头像 URL
 */
export async function updateAvatar(
  userId: string,
  avatarUrl: string
): Promise<{ avatar: string }> {
  const user = await prisma.user.update({
    where: { id: userId },
    data: { avatar: avatarUrl },
    select: { avatar: true },
  });

  return { avatar: user.avatar || "" };
}
