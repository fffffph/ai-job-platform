/**
 * ============================================
 * 活跃用户查询封装（Active User Query）
 * ============================================
 *
 * 【职责】
 * 把「查用户时必须带 deletedAt: null」这条规则收敛到一处，
 * 从源头避免软删除后到处漏加条件。
 *
 * 【为什么需要这个文件】
 * 软删除（User.deletedAt）最大的风险不是删除本身，而是「删了却还能用」：
 * 登录查库、鉴权查库、用户列表、角色分配……任何一处忘了加 deletedAt: null，
 * 已删除的账号就仍然能登录或出现在列表里，而且这种 bug 极难被发现。
 * 因此本项目约定：**业务代码不直接写 prisma.user.findXxx，一律走本文件的封装**。
 *
 * 【两条查询路线（关键区分，别混用）】
 *
 * 1. 唯一性校验 → `findUserByIdentifiers`（**不过滤** deletedAt）
 *    因为数据库唯一索引覆盖全部行（含软删除行），只在应用层过滤会造成
 *    「应用层说没占用、写库时唯一约束报错」的 500，必须与索引口径一致。
 *
 * 2. 登录 / 鉴权 / 列表 → `findActiveUserXxx`（**过滤** deletedAt）
 *    软删除的账号不允许登录、不允许出现在列表。
 */

import prisma from "./prisma.js";
import type { Prisma } from "@prisma/client";
import type { IdentifierField } from "./identifier.js";

// ============================================================
// 通用 where 片段
// ============================================================

/**
 * 「账号可用」的过滤条件（未软删除）。
 *
 * 供业务层在写自己的 where 时展开使用，例如：
 * `prisma.user.count({ where: { ...ACTIVE_USER_FILTER, status: "active" } })`
 */
export const ACTIVE_USER_FILTER = { deletedAt: null } as const;

/** 登录成功后需要回写的审计字段 */
export interface LoginAuditPatch {
  lastLoginAt: Date;
  lastLoginIp: string | null;
  lastLoginMethod: string;
}

// ============================================================
// 1. 鉴权路线
// ============================================================

/**
 * 按 id 查「活跃账号」的状态与 Token 版本（authMiddleware 专用）。
 *
 * 【为什么只取这几列】
 * authMiddleware 在每个请求上都会执行，查询必须尽量窄：
 * 只要 status（是否停用）、tokenVersion（Token 是否已被吊销）、
 * mustChangePassword（是否需强制改密）就够，不需要用户资料。
 *
 * @param id - 用户 id（来自 JWT 的 sub）
 * @returns 账号摘要；不存在或已软删除时返回 null
 */
export async function findActiveAccountById(id: string) {
  return prisma.user.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      status: true,
      tokenVersion: true,
      mustChangePassword: true,
    },
  });
}

// ============================================================
// 2. 登录路线
// ============================================================

/**
 * 登录用：按「已识别出的单一标识字段」查活跃用户。
 *
 * 【为什么只按单一字段查，不做 OR 模糊匹配】
 * 若用 OR 同时匹配 email/phone/username，当 A 的用户名恰好等于 B 的手机号时，
 * 会一句 SQL 查出两个人，无法确定该给谁比对密码，属于账号越权的隐患。
 * 所以先由 resolveIdentifier 判定字段，再精确查该字段。
 *
 * @param field - 已识别的标识字段
 * @param value - 归一化后的标识值
 * @returns 登录所需的用户字段；不存在或已软删除时返回 null
 */
export async function findActiveUserByIdentifier(
  field: IdentifierField,
  value: string
) {
  return prisma.user.findFirst({
    where: { [field]: value, deletedAt: null } as Prisma.UserWhereInput,
    select: {
      id: true,
      email: true,
      phone: true,
      username: true,
      password: true,
      name: true,
      avatar: true,
      bio: true,
      status: true,
      tokenVersion: true,
      mustChangePassword: true,
      createdAt: true,
    },
  });
}

/**
 * 按 id 查活跃用户（登录后签发 Token / 刷新用户信息用）。
 *
 * @param id - 用户 id
 * @param select - 需要返回的字段
 */
export async function findActiveUserById<S extends Prisma.UserSelect>(
  id: string,
  select: S
): Promise<Prisma.UserGetPayload<{ select: S }> | null> {
  const result = await prisma.user.findFirst({
    where: { id, deletedAt: null },
    select,
  });
  return result as Prisma.UserGetPayload<{ select: S }> | null;
}

// ============================================================
// 3. 唯一性校验路线
// ============================================================

/** 唯一性校验入参（归一化后的值） */
export interface IdentifierUniquenessInput {
  email?: string | null;
  phone?: string | null;
  username?: string | null;
}

/**
 * 查已占用某个标识的用户（**不过滤软删除**，与数据库唯一索引口径一致）。
 *
 * 返回命中的第一个用户，并用 `conflictField` 告诉调用方是哪个标识冲突，
 * 便于返回「邮箱已被占用」这类精准提示，而不是笼统的「创建失败」。
 *
 * @param input         - 待校验的标识集合
 * @param excludeUserId - 排除的用户 id（「修改自己的标识」场景必须传自己，
 *                        否则未改动的那些标识会命中自己，被误判成冲突）
 * @returns 冲突信息；无冲突返回 null
 */
export async function findIdentifierConflict(
  input: IdentifierUniquenessInput,
  excludeUserId?: string
): Promise<{ field: IdentifierField; id: string } | null> {
  const conditions = (["email", "phone", "username"] as IdentifierField[])
    .filter((field) => Boolean(input[field]))
    .map((field) => ({ [field]: input[field] }) as Prisma.UserWhereInput);

  if (conditions.length === 0) return null;

  const rows = await prisma.user.findMany({
    where: {
      OR: conditions,
      // 「修改自己的标识」时把自己排除掉：否则「邮箱没改也会报冲突」
      ...(excludeUserId ? { NOT: { id: excludeUserId } } : {}),
    },
    select: { id: true, email: true, phone: true, username: true },
    take: 5,
  });

  if (rows.length === 0) return null;

  // 找出第一个真正冲突的字段（按 email → phone → username 顺序）
  for (const field of ["email", "phone", "username"] as IdentifierField[]) {
    const wanted = input[field];
    if (!wanted) continue;
    const hit = rows.find((row) => row[field] === wanted);
    if (hit) return { field, id: hit.id };
  }

  return null;
}

// ============================================================
// 4. 审计回写
// ============================================================

/**
 * 登录成功后回写审计字段（最后登录时间 / IP / 方式）。
 *
 * 【为什么单独一个函数且不 await 失败】
 * 这是「锦上添花」的审计信息，写失败不应导致用户登录失败，
 * 因此调用方用 `.catch(() => {})` 兜底，不阻塞登录主流程。
 *
 * @param userId - 用户 id
 * @param patch  - 审计字段
 */
export async function touchLoginAudit(
  userId: string,
  patch: LoginAuditPatch
): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      lastLoginAt: patch.lastLoginAt,
      lastLoginIp: patch.lastLoginIp,
      lastLoginMethod: patch.lastLoginMethod,
    },
  });
}
