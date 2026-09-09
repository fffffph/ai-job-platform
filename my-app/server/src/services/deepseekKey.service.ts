/**
 * ============================================
 * DeepSeek API Key 服务模块
 * ============================================
 *
 * 【职责】
 * 管理当前登录用户自行配置的 DeepSeek API Key：
 * - 校验 Key 格式（前缀 + 长度）
 * - 加密存储 / 删除 / 查询状态（脱敏尾号）
 * - 供 resume.service 读取明文（仅服务端内部使用）
 * - 测试连通性（真实调用 DeepSeek 验证 Key 是否有效）
 *
 * 【安全红线】
 * 1. 明文 Key 绝不明文入库 —— 通过 lib/crypto 加密后才落库
 * 2. 明文 Key 绝不写日志 —— 日志只打印脱敏尾号
 * 3. 明文 Key 绝不返回前端 —— 前端只能拿到 maskedTail（脱敏尾号）
 * 4. 按用户隔离 —— 所有操作都以 userId 为条件，用户 A 看不到用户 B 的 Key
 */

import prisma from "../lib/prisma.js";
import { encrypt, decrypt } from "../lib/crypto.js";

// ========== 常量 ==========

/** DeepSeek 官方接口地址 */
const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";

/** Key 格式：以 sk- 开头，最小长度（sk- + 足够位数） */
const KEY_PREFIX = "sk-";
const KEY_MIN_LENGTH = 20;

// ========== 类型定义 ==========

/** 返回给前端的密钥状态（绝不含明文） */
export interface DeepSeekKeyStatus {
  /** 是否已配置 */
  configured: boolean;
  /** 脱敏尾号，如 "sk-****abcd"，未配置时为空字符串 */
  maskedTail: string;
  /** 最后更新时间（ISO 字符串），未配置时为 null */
  updatedAt: string | null;
}

/** 连通性测试结果 */
export interface TestResult {
  /** 是否连通 */
  ok: boolean;
  /** 测试说明（成功/失败原因） */
  message: string;
}

// ========== 校验 ==========

/**
 * 校验 Key 格式
 *
 * DeepSeek 官方 Key 以 "sk-" 开头。
 * 只做格式层面校验（前缀 + 长度），真实有效性由"测试连通性"确认。
 *
 * @throws 校验失败时抛出中文错误信息
 */
export function validateKeyFormat(key: string): void {
  const trimmed = key.trim();

  if (!trimmed) {
    throw new Error("请输入 DeepSeek API Key");
  }

  if (!trimmed.startsWith(KEY_PREFIX)) {
    throw new Error("API Key 格式不正确，应以 sk- 开头");
  }

  if (trimmed.length < KEY_MIN_LENGTH) {
    throw new Error("API Key 长度不足，请检查是否复制完整");
  }
}

/**
 * 生成脱敏尾号（如 sk-****abcd）
 * 仅用于日志和前端展示，绝不含完整 Key。
 */
function maskKey(key: string): string {
  const tail = key.slice(-4);
  return `sk-****${tail}`;
}

// ========== 查询与读取 ==========

/**
 * 获取用户密钥状态（脱敏，供前端展示）
 */
export async function getKeyStatus(userId: string): Promise<DeepSeekKeyStatus> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      deepseekKeyCipher: true,
      deepseekKeyUpdatedAt: true,
    },
  });

  if (!user) {
    throw new Error("用户不存在");
  }

  if (!user.deepseekKeyCipher) {
    return { configured: false, maskedTail: "", updatedAt: null };
  }

  let maskedTail = "";
  try {
    maskedTail = maskKey(decrypt(user.deepseekKeyCipher));
  } catch {
    // 解密失败（如加密密钥变更），视为未配置，避免抛出敏感错误
    return { configured: false, maskedTail: "", updatedAt: null };
  }

  return {
    configured: true,
    maskedTail,
    updatedAt: user.deepseekKeyUpdatedAt?.toISOString() ?? null,
  };
}

/**
 * 获取用户已解密的 Key 明文（仅服务端内部使用，绝不下发前端）
 *
 * 解析顺序：
 * 1. 用户自己配置的 Key（优先）
 * 2. 服务端环境变量 DEEPSEEK_API_KEY（可选兜底默认值）
 *
 * @returns 明文 Key；两者都没有时返回空字符串
 */
export async function getDecryptedKey(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { deepseekKeyCipher: true },
  });

  if (user?.deepseekKeyCipher) {
    try {
      return decrypt(user.deepseekKeyCipher);
    } catch {
      // 解密失败，落到环境变量兜底
    }
  }

  // 服务端兜底默认值（可选）
  return process.env.DEEPSEEK_API_KEY || "";
}

// ========== 保存 / 删除 ==========

/**
 * 保存（加密存储）用户的 Key
 *
 * @param userId - 用户 ID
 * @param plainKey - 明文 Key（来自前端表单）
 * @returns 脱敏状态
 */
export async function saveKey(
  userId: string,
  plainKey: string
): Promise<DeepSeekKeyStatus> {
  // 先校验格式
  validateKeyFormat(plainKey);

  const cipher = encrypt(plainKey.trim());

  await prisma.user.update({
    where: { id: userId },
    data: {
      deepseekKeyCipher: cipher,
      deepseekKeyUpdatedAt: new Date(),
    },
  });

  console.log(`[deepseek-key] 用户 ${userId.slice(0, 8)} 保存 API Key: ${maskKey(plainKey)}`);

  return getKeyStatus(userId);
}

/**
 * 删除（清空）用户的 Key
 */
export async function deleteKey(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      deepseekKeyCipher: null,
      deepseekKeyUpdatedAt: null,
    },
  });

  console.log(`[deepseek-key] 用户 ${userId.slice(0, 8)} 已删除 API Key`);
}

// ========== 连通性测试 ==========

/**
 * 测试 Key 连通性
 *
 * 用传入的明文 Key（可能还未保存）调用 DeepSeek 的 models 接口，
 * 通过返回码判断 Key 是否有效。
 *
 * @param plainKey - 明文 Key
 * @returns 测试结果
 */
export async function testKey(plainKey: string): Promise<TestResult> {
  validateKeyFormat(plainKey);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);

  try {
    // 用一个极小的请求验证 Key 是否有效
    const res = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${plainKey.trim()}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
      }),
      signal: controller.signal,
    });

    if (res.ok) {
      return { ok: true, message: "连接成功，API Key 有效" };
    }

    // 401 → 无效密钥；402 → 余额不足；429 → 限流；其他 → 通用错误
    const raw = await res.text().catch(() => "");
    if (res.status === 401) {
      return { ok: false, message: "API Key 无效（401），请检查是否复制完整" };
    }
    if (res.status === 402) {
      return { ok: false, message: "账户余额不足（402），请前往 DeepSeek 充值" };
    }
    if (res.status === 429) {
      return { ok: false, message: "请求过于频繁（429），请稍后重试" };
    }
    return {
      ok: false,
      message: `连接失败（${res.status}）：${raw.slice(0, 100) || "未知错误"}`,
    };
  } catch (e: any) {
    if (e.name === "AbortError") {
      return { ok: false, message: "测试超时（15s），请检查网络后重试" };
    }
    return { ok: false, message: `网络错误：${e.message}` };
  } finally {
    clearTimeout(timer);
  }
}
