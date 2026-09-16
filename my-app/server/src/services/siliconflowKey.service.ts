/**
 * ============================================
 * SiliconFlow API Key 服务模块
 * ============================================
 *
 * 【职责】
 * 管理当前登录用户自行配置的 SiliconFlow（硅基流动）API Key：
 * - 校验 Key 格式（前缀 + 长度）
 * - 加密存储 / 删除 / 查询状态（脱敏尾号）
 * - 供 RAG 知识库的 Embedding 向量化读取明文（仅服务端内部使用）
 * - 测试连通性（真实调用 SiliconFlow 验证 Key 是否有效）
 *
 * 【与 DeepSeek Key 的关系】
 * 两者独立配置、独立存储、独立使用：
 * - DeepSeek Key → 对话/分析类 LLM 调用（简历优化、知识库问答生成、职位推荐）
 * - SiliconFlow Key → Embedding 向量化（知识库文档入库、检索）
 *
 * 【安全红线】（与 DeepSeek Key 一致）
 * 1. 明文 Key 绝不明文入库 —— 通过 lib/crypto 加密后才落库
 * 2. 明文 Key 绝不写日志 —— 日志只打印脱敏尾号
 * 3. 明文 Key 绝不返回前端 —— 前端只能拿到 maskedTail（脱敏尾号）
 * 4. 按用户隔离 —— 所有操作都以 userId 为条件
 */

import prisma from "../lib/prisma.js";
import { encrypt, decrypt } from "../lib/crypto.js";

// ========== 常量 ==========

/** SiliconFlow 官方 OpenAI 兼容接口地址（models 接口用于连通性测试） */
const SILICONFLOW_URL = "https://api.siliconflow.cn/v1/models";

/** Key 格式：以 sk- 开头，最小长度（sk- + 足够位数） */
const KEY_PREFIX = "sk-";
const KEY_MIN_LENGTH = 20;

// ========== 类型定义 ==========

/** 返回给前端的密钥状态（绝不含明文） */
export interface SiliconFlowKeyStatus {
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
 * 校验 Key 格式。
 * SiliconFlow 官方 Key 以 "sk-" 开头，与 DeepSeek 一致。
 *
 * @throws 校验失败时抛出中文错误信息
 */
export function validateKeyFormat(key: string): void {
  const trimmed = key.trim();

  if (!trimmed) {
    throw new Error("请输入 SiliconFlow API Key");
  }

  if (!trimmed.startsWith(KEY_PREFIX)) {
    throw new Error("API Key 格式不正确，应以 sk- 开头");
  }

  if (trimmed.length < KEY_MIN_LENGTH) {
    throw new Error("API Key 长度不足，请检查是否复制完整");
  }
}

/**
 * 生成脱敏尾号（如 sk-****abcd），仅用于日志和前端展示。
 */
function maskKey(key: string): string {
  const tail = key.slice(-4);
  return `sk-****${tail}`;
}

// ========== 查询与读取 ==========

/**
 * 获取用户密钥状态（脱敏，供前端展示）。
 */
export async function getKeyStatus(
  userId: string
): Promise<SiliconFlowKeyStatus> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      siliconflowKeyCipher: true,
      siliconflowKeyUpdatedAt: true,
    },
  });

  if (!user) {
    throw new Error("用户不存在");
  }

  if (!user.siliconflowKeyCipher) {
    return { configured: false, maskedTail: "", updatedAt: null };
  }

  let maskedTail = "";
  try {
    maskedTail = maskKey(decrypt(user.siliconflowKeyCipher));
  } catch {
    return { configured: false, maskedTail: "", updatedAt: null };
  }

  return {
    configured: true,
    maskedTail,
    updatedAt: user.siliconflowKeyUpdatedAt?.toISOString() ?? null,
  };
}

/**
 * 获取用户已解密的 SiliconFlow Key 明文（仅服务端内部使用，绝不下发前端）。
 *
 * 解析顺序：
 * 1. 用户自己配置的 Key（优先）
 * 2. 服务端环境变量 SILICONFLOW_API_KEY（可选兜底默认值）
 *
 * @returns 明文 Key；两者都没有时返回空字符串
 */
export async function getDecryptedSiliconflowKey(
  userId: string
): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { siliconflowKeyCipher: true },
  });

  if (user?.siliconflowKeyCipher) {
    try {
      return decrypt(user.siliconflowKeyCipher);
    } catch {
      // 解密失败，落到环境变量兜底
    }
  }

  // 服务端兜底默认值（可选）
  return process.env.SILICONFLOW_API_KEY || "";
}

// ========== 保存 / 删除 ==========

/**
 * 保存（加密存储）用户的 Key。
 */
export async function saveKey(
  userId: string,
  plainKey: string
): Promise<SiliconFlowKeyStatus> {
  validateKeyFormat(plainKey);

  const cipher = encrypt(plainKey.trim());

  await prisma.user.update({
    where: { id: userId },
    data: {
      siliconflowKeyCipher: cipher,
      siliconflowKeyUpdatedAt: new Date(),
    },
  });

  console.log(
    `[siliconflow-key] 用户 ${userId.slice(0, 8)} 保存 API Key: ${maskKey(plainKey)}`
  );

  return getKeyStatus(userId);
}

/**
 * 删除（清空）用户的 Key。
 */
export async function deleteKey(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      siliconflowKeyCipher: null,
      siliconflowKeyUpdatedAt: null,
    },
  });

  console.log(`[siliconflow-key] 用户 ${userId.slice(0, 8)} 已删除 API Key`);
}

// ========== 连通性测试 ==========

/**
 * 测试 Key 连通性。
 *
 * 调用 SiliconFlow 的 models 接口（GET /v1/models），通过返回码判断 Key 是否有效。
 *
 * @param plainKey - 明文 Key
 * @returns 测试结果
 */
export async function testKey(plainKey: string): Promise<TestResult> {
  validateKeyFormat(plainKey);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await fetch(SILICONFLOW_URL, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${plainKey.trim()}`,
      },
      signal: controller.signal,
    });

    if (res.ok) {
      return { ok: true, message: "连接成功，API Key 有效" };
    }

    const raw = await res.text().catch(() => "");
    if (res.status === 401) {
      return { ok: false, message: "API Key 无效（401），请检查是否复制完整" };
    }
    if (res.status === 403) {
      return { ok: false, message: "无访问权限（403），请检查 Key 是否有效" };
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
