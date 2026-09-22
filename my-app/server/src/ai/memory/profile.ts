/**
 * ============================================
 * 用户求职画像（Memory 层：结构化记忆）
 * ============================================
 *
 * 【职责】
 * 提供用户求职画像的读写，实现职位推荐 Agent 的「跨轮记忆」：
 * - 用户首次填写求职意向（城市/技能/薪资/岗位）后落库；
 * - 下次推荐时 Agent 读取画像，无需用户重复输入，实现个性化。
 *
 * 【记忆语义】
 * 采用「合并更新」——只更新用户本次填写的非空字段，空字段保留
 * 既有记忆，避免用户漏填某字段时覆盖掉之前的偏好。
 */

import prisma from "../../lib/prisma.js";

/** 用户求职画像（结构化记忆） */
export interface JobProfile {
  /** 求职方向/岗位，如 "前端开发工程师" */
  jobTitle: string;
  /** 期望城市，如 "西安" */
  city: string;
  /** 技能栈，如 "React,TypeScript,微前端,Node.js" */
  skills: string;
  /** 期望薪资，如 "12k-18k" */
  expectedSalary: string;
}

/**
 * 读取用户的求职画像。
 *
 * @param userId - 用户 ID
 * @returns 画像对象；未设置过时返回 null
 */
export async function getJobProfile(
  userId: string
): Promise<JobProfile | null> {
  const profile = await prisma.userProfile.findUnique({
    where: { userId },
  });

  if (!profile) {
    return null;
  }

  return {
    jobTitle: profile.jobTitle ?? "",
    city: profile.city ?? "",
    skills: profile.skills ?? "",
    expectedSalary: profile.expectedSalary ?? "",
  };
}

/**
 * 保存（合并更新）用户的求职画像。
 *
 * 采用 upsert：不存在则创建，存在则更新。只更新传入的非空字段，
 * 空字段保留既有记忆（合并语义，避免覆盖）。
 *
 * @param userId  - 用户 ID
 * @param profile - 要保存的画像字段（可只传部分字段）
 * @returns 保存后的完整画像
 */
export async function saveJobProfile(
  userId: string,
  profile: Partial<JobProfile>
): Promise<JobProfile> {
  // 过滤出非空字段，实现「只更新本次填写项」的合并语义
  const data: {
    jobTitle?: string;
    city?: string;
    skills?: string;
    expectedSalary?: string;
  } = {};
  if (profile.jobTitle?.trim()) data.jobTitle = profile.jobTitle.trim();
  if (profile.city?.trim()) data.city = profile.city.trim();
  if (profile.skills?.trim()) data.skills = profile.skills.trim();
  if (profile.expectedSalary?.trim()) {
    data.expectedSalary = profile.expectedSalary.trim();
  }

  // upsert：按 userId 唯一，存在则更新，不存在则创建
  const saved = await prisma.userProfile.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });

  return {
    jobTitle: saved.jobTitle ?? "",
    city: saved.city ?? "",
    skills: saved.skills ?? "",
    expectedSalary: saved.expectedSalary ?? "",
  };
}
