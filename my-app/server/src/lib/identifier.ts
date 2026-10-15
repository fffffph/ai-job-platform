/**
 * ============================================
 * 登录标识识别模块（Identifier Resolver）
 * ============================================
 *
 * 【职责】
 * 统一账号体系的核心判定逻辑：把用户输入的「一个字符串」判定为
 * 邮箱 / 手机号 / 用户名 三者之一，并给出该标识的格式校验规则。
 *
 * 【为什么必须集中在这一处（单一事实源）】
 * 前端登录页要做「实时识别 + 切换图标 + 提示文案」，后端要做「权威判定 + 查库」。
 * 如果两边各写一套正则，一旦漂移（前端判成手机号、后端判成用户名），
 * 就会出现「提示手机号登录、实际按用户名查」的诡异登录失败，且极难排查。
 * 因此：后端本文件为权威实现，前端 `lib/identifier.ts` 复制同一份常量与用例。
 *
 * 【识别规则】
 * - 含 "@"                → email
 * - ^1[3-9]\d{9}$         → phone（中国大陆手机号，11 位）
 * - ^[a-zA-Z0-9_-]{3,20}$ → username
 * - 其他                   → null（格式非法）
 *
 * 【为什么 username 禁止纯数字？】
 * 纯数字用户名（如 "13800000000"）会被手机号规则优先命中，
 * 造成「注册时是用户名、登录时被判成手机号」的死账号。
 * 因此在注册 / 新增用户校验阶段就明确禁止。
 */

// ============================================================
// 标识字段类型与常量
// ============================================================

/** 三个登录标识对应的 User 表字段名 */
export type IdentifierField = "email" | "phone" | "username";

/** 全部标识字段（用于遍历校验「至少填一个」） */
export const IDENTIFIER_FIELDS: IdentifierField[] = ["email", "phone", "username"];

/** 标识字段的中文名（错误提示用） */
export const IDENTIFIER_LABELS: Record<IdentifierField, string> = {
  email: "邮箱",
  phone: "手机号",
  username: "用户名",
};

/** 邮箱格式（与注册控制器保持一致，宽松校验） */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * 中国大陆手机号：1 开头、第二位 3-9、共 11 位纯数字。
 *
 * 【为什么存库不带分隔符】
 * 统一存 11 位纯数字（如 13800000000），前端展示时再格式化。
 * 否则 "138 0000 0000" 与 "13800000000" 会绕过唯一约束，
 * 变成同一个人的两个账号。
 */
export const PHONE_PATTERN = /^1[3-9]\d{9}$/;

/** 用户名：3-20 位字母/数字/下划线/中划线 */
export const USERNAME_PATTERN = /^[a-zA-Z0-9_-]{3,20}$/;

/** 用户名长度范围（错误提示用） */
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 20;

// ============================================================
// 识别
// ============================================================

/** 标识识别结果 */
export interface ResolvedIdentifier {
  /** 命中的字段 */
  field: IdentifierField;
  /** 归一化后的值（手机号去空格、用户名转小写、邮箱转小写） */
  value: string;
}

/**
 * 把用户输入的账号字符串识别为具体的登录标识。
 *
 * 【判定优先级】邮箱 → 手机号 → 用户名。
 * 邮箱放最前是因为 "@" 是强特征、绝不会与另两者歧义。
 *
 * 【两处易踩的坑（已处理）】
 * 1. 手机号必须**先剥离分隔符再判定**：
 *    用户习惯输入 "138 0000 1111" / "138-0000-1111"，
 *    直接拿原文匹配 PHONE_PATTERN 会判成非法，用户一脸茫然。
 * 2. 用户名必须**归一化为小写**：
 *    写库时 normalizeIdentifier 会把用户名转小写，
 *    若这里返回原文 "LISI"，查询条件就变成 username = 'LISI'，
 *    与库里的 'lisi' 对不上，导致「明明注册成功却登不进去」。
 *    两边口径必须完全一致。
 *
 * @param input - 用户输入的原始字符串（可含首尾空格）
 * @returns 识别结果；格式非法时返回 null
 */
export function resolveIdentifier(input: string): ResolvedIdentifier | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;

  // 1. 邮箱：含 @ 即按邮箱处理（格式由 EMAIL_PATTERN 兜底校验）
  if (raw.includes("@")) {
    const email = raw.toLowerCase();
    return EMAIL_PATTERN.test(email) ? { field: "email", value: email } : null;
  }

  // 2. 手机号：先剥离空格、中划线、括号等常见分隔符，再判定
  const digitsOnly = raw.replace(/[\s\-()]/g, "");
  if (PHONE_PATTERN.test(digitsOnly)) {
    return { field: "phone", value: digitsOnly };
  }

  // 3. 用户名：3-20 位字母数字下划线中划线，且不允许纯数字
  //    纯数字会被上面的手机号规则抢走，这里显式排除，避免产生「无法登录的死账号」
  if (USERNAME_PATTERN.test(raw) && !/^\d+$/.test(raw)) {
    return { field: "username", value: raw.toLowerCase() };
  }

  return null;
}

/**
 * 归一化单个标识值（供注册 / 新增用户 / 绑定标识等写入场景使用）。
 *
 * - email / username → 转小写（避免 "Zhang" 与 "zhang" 注册出两个账号）
 * - phone            → 去掉空格、中划线、括号等分隔符，统一存 11 位纯数字
 *
 * @param field - 标识字段
 * @param value - 原始值
 * @returns 归一化后的值；空值时返回 null（便于直接写库）
 */
export function normalizeIdentifier(
  field: IdentifierField,
  value: string | null | undefined
): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;

  if (field === "phone") {
    // 只保留数字，兼容用户输入 "138 0000 0000" / "138-0000-0000"
    return raw.replace(/\D/g, "");
  }

  return raw.toLowerCase();
}

/**
 * 校验单个标识值是否符合格式（归一化后再校验）。
 *
 * @param field - 标识字段
 * @param value - 归一化后的值
 * @returns 是否合法
 */
export function isValidIdentifierValue(
  field: IdentifierField,
  value: string
): boolean {
  switch (field) {
    case "email":
      return EMAIL_PATTERN.test(value);
    case "phone":
      return PHONE_PATTERN.test(value);
    case "username":
      return USERNAME_PATTERN.test(value) && !/^\d+$/.test(value);
  }
}

// ============================================================
// 「至少一个登录标识」校验
// ============================================================

/** 校验错误（由调用方决定映射成哪个 HTTP 状态码） */
export class IdentifierValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdentifierValidationError";
  }
}

/**
 * 标识已被占用错误。
 *
 * 【为什么要与「格式错误」区分开】
 * 两者都是 400 级别的「用户填错了」，但语义完全不同：
 * - 格式错误 → 400 IDENTIFIER_INVALID（让用户改格式）
 * - 已被占用 → 409 IDENTIFIER_EXISTS（让用户换一个）
 * 前端要按错误码做不同提示，所以必须能分辨，不能都塞进
 * IdentifierValidationError 里靠字符串匹配。
 */
export class IdentifierConflictError extends Error {
  /** 冲突的字段（email / phone / username） */
  readonly field: IdentifierField;

  constructor(field: IdentifierField) {
    super(`${IDENTIFIER_LABELS[field]}已被占用，请更换`);
    this.name = "IdentifierConflictError";
    this.field = field;
  }
}

/** 待校验的标识集合 */
export interface IdentifierInput {
  email?: string | null;
  phone?: string | null;
  username?: string | null;
}

/** 归一化后的标识集合（可直接用于建用户 / 查重） */
export interface NormalizedIdentifiers {
  email: string | null;
  phone: string | null;
  username: string | null;
}

/**
 * 校验并归一化一组登录标识。
 *
 * 【规则】
 * 1. 三个标识至少填一个，否则账号创建后无法登录；
 * 2. 填了的每个都要符合各自格式；
 * 3. 返回全部归一化的值（未填的为 null），供调用方直接写库。
 *
 * 【为什么必须校验「至少一个」】
 * Prisma schema 里三个字段都是可空 + 唯一，数据库层拦不住「三个全空」。
 * 若不在此处拦截，就会产生既登不进、又找不回的孤儿账号。
 *
 * @param input - 待校验的标识集合
 * @returns 归一化后的标识
 * @throws IdentifierValidationError 全部为空或任一格式非法时抛出
 */
export function normalizeAndValidateIdentifiers(
  input: IdentifierInput
): NormalizedIdentifiers {
  const result: NormalizedIdentifiers = {
    email: normalizeIdentifier("email", input.email),
    phone: normalizeIdentifier("phone", input.phone),
    username: normalizeIdentifier("username", input.username),
  };

  // 逐个校验已填写的标识格式
  for (const field of IDENTIFIER_FIELDS) {
    const value = result[field];
    if (value && !isValidIdentifierValue(field, value)) {
      throw new IdentifierValidationError(
        `${IDENTIFIER_LABELS[field]}格式不正确${
          field === "username"
            ? `（${USERNAME_MIN_LENGTH}-${USERNAME_MAX_LENGTH} 位字母、数字、下划线或中划线，且不能是纯数字）`
            : ""
        }`
      );
    }
  }

  // 至少一个非空
  if (!IDENTIFIER_FIELDS.some((field) => result[field])) {
    throw new IdentifierValidationError(
      "请至少填写一项登录标识（邮箱 / 手机号 / 用户名），否则该账号无法登录"
    );
  }

  return result;
}

/**
 * 断言一组登录标识里至少有一个非空（不关心格式，只查空）。
 *
 * 用于「必须已存在至少一个标识」的轻量场景。
 *
 * @param input - 待校验的标识集合
 * @throws IdentifierValidationError 全部为空时抛出
 */
export function assertHasLoginIdentity(input: IdentifierInput): void {
  const hasAny = IDENTIFIER_FIELDS.some((field) => {
    const value = normalizeIdentifier(field, input[field]);
    return Boolean(value);
  });

  if (!hasAny) {
    throw new IdentifierValidationError(
      "请至少填写一项登录标识（邮箱 / 手机号 / 用户名）"
    );
  }
}
