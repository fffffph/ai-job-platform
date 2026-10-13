/**
 * ============================================
 * 系统配置服务（Config Service）
 * ============================================
 *
 * 【职责】
 * 统一封装配置项的「读取 + 回退 + 缓存 + 校验 + 写入」：
 * - 读：三级回退（DB 覆盖值 → 环境变量 → 注册表默认值）+ 内存缓存
 * - 写：按注册表校验类型/范围，写库后主动失效缓存（改完立即生效）
 * - enabled 判断：覆盖值被禁用时回退默认值（保留覆盖值，可随时重新启用）
 *
 * 【生效机制】
 * 单进程内存缓存 + 写后主动失效，秒级生效、无需重启。
 * 项目已确认暂不做 Docker 多实例，故不引 Redis、不加 TTL。
 *
 * 【为什么读走缓存、写走失效？】
 * - 读走缓存：避免每次请求都查库（AI 图每个请求都会读一批配置）；
 * - 写走失效：改完立即删缓存，保证下一个请求读到新值，prompt 可边改边测。
 */

import prisma from "../lib/prisma.js";
import type { Prisma } from "@prisma/client";
import {
  CONFIG_SCHEMA,
  findConfig,
  getConfigsByGroup,
  isValidConfigKey,
  type ConfigFieldDef,
  type ConfigGroup,
  type ConfigType,
} from "./schema.js";

// ============================================================
// 配置校验错误（区别于系统错误）
// ============================================================

/**
 * 配置校验/非法输入错误。
 *
 * 用于「key 未注册、值类型不符、范围越界」等用户输入非法场景。
 * 路由层通过 instanceof 识别此类错误，返回 400（而非全局的 500）。
 */
export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigValidationError";
  }
}

// ============================================================
// 内存缓存（单进程）
// ============================================================

/**
 * 配置值缓存：key → 有效值。
 * 读命中直接返回，写后 delete 失效。
 */
const cache = new Map<string, unknown>();

/**
 * 清空全部缓存（重置全部配置后调用）。
 */
export function clearConfigCache(): void {
  cache.clear();
}

// ============================================================
// 环境变量回退映射（预留扩展点）
// ============================================================

/**
 * 配置 key → 环境变量名 的映射。
 *
 * 当前项目配置项均无环境变量回退需求，故映射为空；
 * 将来若某配置项需要「从环境变量读取兜底值」，在此登记即可，
 * envFallback 会自动做类型感知转换。
 *
 * 示例（未来）：
 *   "llm.model": "DEEPSEEK_MODEL",
 */
const ENV_FALLBACK_MAP: Record<string, string> = {};

/**
 * 从环境变量读取配置的兜底值（未登记/未设置时返回 undefined）。
 *
 * 按配置项类型做感知转换：number → Number()，boolean → "true"/"1"，
 * json/json-array → JSON.parse()，其余原样返回字符串。
 */
function envFallback(def: ConfigFieldDef): unknown {
  const envName = ENV_FALLBACK_MAP[def.key];
  if (!envName) return undefined;

  const raw = process.env[envName];
  if (raw === undefined) return undefined;

  switch (def.type) {
    case "number":
      return Number(raw);
    case "boolean":
      return raw === "true" || raw === "1";
    case "json":
    case "json-array":
      try {
        return JSON.parse(raw);
      } catch {
        return undefined; // 非法 JSON 视为未设置，继续走默认值
      }
    default:
      return raw;
  }
}

// ============================================================
// 值安全工具
// ============================================================

/**
 * 深拷贝一个值，避免外部修改污染缓存/默认值的共享引用。
 * primitive（string/number/boolean/null/undefined）直接返回，object 走 JSON 深拷贝。
 */
function cloneValue<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
}

/**
 * 把配置值转成 Prisma Json 字段可接受的类型。
 * value 已经过 validateConfig 校验，不会是 undefined/null，
 * 这里做一次 JSON 往返深拷贝，确保与缓存/默认值解耦。
 */
function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

// ============================================================
// 读取
// ============================================================

/**
 * 读取单个配置项的有效值（含缓存 + 三级回退 + enabled 判断）。
 *
 * 回退顺序：
 *   1. DB 覆盖值（system_configs.value，且 enabled=true）→ 命中直接返回
 *   2. 环境变量（ENV_FALLBACK_MAP 登记过的项）
 *   3. 注册表 defaultValue（最终兜底，永不为空）
 *
 * @param key - 配置键（需已在 CONFIG_SCHEMA 注册）
 * @returns 有效值（类型由调用方泛型约束）
 * @throws key 未注册时抛出错误
 */
export async function getConfig<T>(key: string): Promise<T> {
  // 命中缓存直接返回
  const cached = cache.get(key);
  if (cached !== undefined) return cached as T;

  const def = findConfig(key);

  // —— 动态配置（自定义 key，不在注册表内）——
  // 无代码默认值，直接读 DB 覆盖值；无覆盖时返回 undefined（由调用方兜底）。
  if (!def) {
    const row = await prisma.systemConfig.findUnique({ where: { key } });
    if (row && row.enabled && row.value !== null && row.value !== undefined) {
      cache.set(key, row.value);
      return row.value as T;
    }
    // 动态 key 无覆盖值：不缓存 undefined（避免后续新增后读到旧缓存）
    return undefined as T;
  }

  // 查 DB 覆盖值
  const row = await prisma.systemConfig.findUnique({ where: { key } });

  // 三级回退：DB（enabled 时）→ env → 默认值
  let value: unknown;
  if (row && row.enabled && row.value !== null && row.value !== undefined) {
    value = row.value;
  } else {
    const envVal = envFallback(def);
    value = envVal !== undefined ? envVal : def.defaultValue;
  }

  cache.set(key, value);
  return value as T;
}

/**
 * 读取某一分组下所有配置项的有效值（批量，避免 N 次查库）。
 *
 * @param group - 配置分组
 * @returns key → 有效值 的映射
 */
export async function getConfigGroup(
  group: ConfigGroup
): Promise<Record<string, unknown>> {
  const defs = getConfigsByGroup(group);
  const result: Record<string, unknown> = {};
  for (const def of defs) {
    result[def.key] = await getConfig(def.key);
  }
  return result;
}

/**
 * 配置项的「有效状态」视图（供前端「系统设置」页一次渲染）。
 */
export interface EffectiveConfigItem {
  key: string;
  type: ConfigType;
  label: string;
  description?: string;
  group: ConfigGroup;
  /** 内置默认值 */
  defaultValue: unknown;
  /** 当前是否启用（DB enabled 优先，无覆盖则取注册表 enabled） */
  enabled: boolean;
  /** 有效值（回退后的最终值） */
  value: unknown;
  /** 是否已被覆盖（DB 存在该 key 的覆盖值） */
  overridden: boolean;
  // —— 以下为前端渲染控件所需的元数据（从注册表透传） ——
  /** number 类型：最小值 */
  min?: number;
  /** number 类型：最大值 */
  max?: number;
  /** string 类型：可选下拉选项 */
  enum?: Array<{ value: string; label: string }>;
  /** json / json-array 类型：结构说明（给编辑者看的示例） */
  jsonSchema?: string;
}

/**
 * 读取全部配置项的有效状态（一次查库，供前端一次渲染）。
 *
 * @returns 按注册表顺序排列的有效配置项列表
 */
export async function getEffectiveConfigs(): Promise<EffectiveConfigItem[]> {
  const rows = await prisma.systemConfig.findMany();
  const rowMap = new Map(rows.map((r) => [r.key, r]));

  // ---------- 1. 注册表项（按注册表顺序，三级回退） ----------
  const registryItems: EffectiveConfigItem[] = CONFIG_SCHEMA.map((def) => {
    const row = rowMap.get(def.key);
    const overridden = Boolean(
      row && row.value !== null && row.value !== undefined
    );

    let value: unknown;
    if (row && row.enabled && row.value !== null && row.value !== undefined) {
      value = row.value;
    } else {
      const envVal = envFallback(def);
      value = envVal !== undefined ? envVal : def.defaultValue;
    }

    return {
      key: def.key,
      type: def.type,
      label: def.label,
      description: def.description,
      group: def.group,
      defaultValue: def.defaultValue,
      enabled: row ? row.enabled : def.enabled,
      value: cloneValue(value),
      overridden,
      // 前端渲染控件所需的元数据（number 范围 / string 下拉 / json 说明）
      min: def.min,
      max: def.max,
      enum: def.enum,
      jsonSchema: def.jsonSchema,
    };
  });

  // ---------- 2. 动态项（DB 中存在、但不在注册表内的自定义 key） ----------
  const dynamicItems: EffectiveConfigItem[] = rows
    .filter((row) => !findConfig(row.key))
    .map((row) => ({
      key: row.key,
      // DB 存的是 string，转换为 ConfigType（创建时已按类型白名单校验）
      type: row.type as ConfigType,
      label: row.label ?? row.key,
      description: "自定义配置（管理员在设置页新增）",
      group: "custom" as ConfigGroup,
      // 动态配置无代码默认值，defaultValue 置空
      defaultValue: undefined,
      enabled: row.enabled,
      value: cloneValue(row.value ?? undefined),
      overridden: true,
    }));

  return [...registryItems, ...dynamicItems];
}

// ============================================================
// 校验
// ============================================================

/**
 * 按注册表校验配置值（类型 + 范围）。
 *
 * @param key   - 配置键
 * @param value - 待校验的值
 * @throws key 未注册 / 类型不符 / 范围越界时抛出中文错误
 */
export function validateConfig(key: string, value: unknown): void {
  const def = findConfig(key);
  if (!def) {
    throw new ConfigValidationError(`未注册的配置项：${key}`);
  }
  validateValueByType(def.type, def.label, value, { min: def.min, max: def.max });
}

/**
 * 按「类型」校验配置值（类型 + 范围）。
 *
 * 注册表项与动态配置（自定义 key）共用同一套类型校验：
 * - 注册表项：由 validateConfig 传入 def.type/label/min/max；
 * - 动态项：创建/编辑时由调用方传入 DB 里存的 type / label（无 min/max）。
 *
 * @param type  - 配置值类型
 * @param label - 展示名（报错提示用，注册表用中文名，动态用 key 或 label）
 * @param value - 待校验的值
 * @param range - number 类型的取值范围（可选）
 * @throws 类型不符 / 范围越界时抛出中文错误
 */
export function validateValueByType(
  type: ConfigType,
  label: string,
  value: unknown,
  range?: { min?: number; max?: number }
): void {
  switch (type) {
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new ConfigValidationError(`配置项「${label}」的值必须是数字`);
      }
      if (range?.min !== undefined && value < range.min) {
        throw new ConfigValidationError(`配置项「${label}」的值不能小于 ${range.min}`);
      }
      if (range?.max !== undefined && value > range.max) {
        throw new ConfigValidationError(`配置项「${label}」的值不能大于 ${range.max}`);
      }
      break;
    }
    case "boolean": {
      if (typeof value !== "boolean") {
        throw new ConfigValidationError(`配置项「${label}」的值必须是布尔值`);
      }
      break;
    }
    case "string":
    case "textarea": {
      if (typeof value !== "string") {
        throw new ConfigValidationError(`配置项「${label}」的值必须是字符串`);
      }
      break;
    }
    case "json": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new ConfigValidationError(`配置项「${label}」的值必须是 JSON 对象`);
      }
      break;
    }
    case "json-array": {
      if (!Array.isArray(value)) {
        throw new ConfigValidationError(`配置项「${label}」的值必须是 JSON 数组`);
      }
      break;
    }
    case "file": {
      // file 类型 value 存 fileId（string），当前无实际项，仅校验为字符串
      if (typeof value !== "string") {
        throw new ConfigValidationError(`配置项「${label}」的值必须是文件 ID 字符串`);
      }
      break;
    }
  }
}

// ============================================================
// 写入
// ============================================================

/**
 * 写入单个配置项的覆盖值（校验 + upsert + 失效缓存）。
 *
 * @param key     - 配置键
 * @param value   - 覆盖值
 * @param enabled - 是否启用（默认 true）
 * @param updatedBy - 修改人 userId（可选，用于审计）
 */
export async function setConfig(
  key: string,
  value: unknown,
  enabled: boolean = true,
  updatedBy?: string
): Promise<void> {
  const def = findConfig(key);

  // 记录类型与中文名，用于 create 分支补全字段
  let type: ConfigType;
  let label: string | null | undefined;

  if (def) {
    // 注册表项：按注册表类型校验
    validateConfig(key, value);
    type = def.type;
    label = undefined; // 注册表项 DB 不存 label，读取时用注册表
  } else {
    // 动态项（自定义 key）：查 DB 取 type/label，按 DB 类型校验
    const row = await prisma.systemConfig.findUnique({ where: { key } });
    if (!row) {
      throw new ConfigValidationError(`配置项「${key}」不存在，请先在设置页新增`);
    }
    validateValueByType(row.type as ConfigType, row.label ?? key, value);
    type = row.type as ConfigType;
    label = row.label;
  }

  await prisma.systemConfig.upsert({
    where: { key },
    update: { value: toJsonValue(value), enabled, updatedBy },
    // create 分支在「编辑」场景不会走到（前面已校验存在），为类型安全仍补全
    create: { key, value: toJsonValue(value), enabled, updatedBy, type, label },
  });

  // 主动失效缓存，下一个请求读到新值
  cache.delete(key);
}

/**
 * 批量写入配置项（先整体校验，再事务原子写入）。
 *
 * @param items - { key, value, enabled? } 数组
 * @param updatedBy - 修改人 userId（可选）
 */
export async function setConfigs(
  items: Array<{ key: string; value: unknown; enabled?: boolean }>,
  updatedBy?: string
): Promise<void> {
  // 先整体校验（注册表项按注册表类型、动态项按 DB 类型），任一非法则全部不写。
  // 同时收集每项 type/label，供 create 分支补全字段。
  const meta: Array<{ type: ConfigType; label?: string | null }> = [];

  for (const item of items) {
    const def = findConfig(item.key);
    if (def) {
      validateConfig(item.key, item.value);
      meta.push({ type: def.type });
    } else {
      const row = await prisma.systemConfig.findUnique({ where: { key: item.key } });
      if (!row) {
        throw new ConfigValidationError(`配置项「${item.key}」不存在，请先新增`);
      }
      validateValueByType(row.type as ConfigType, row.label ?? item.key, item.value);
      meta.push({ type: row.type as ConfigType, label: row.label });
    }
  }

  await prisma.$transaction(
    items.map((item, i) =>
      prisma.systemConfig.upsert({
        where: { key: item.key },
        update: {
          value: toJsonValue(item.value),
          enabled: item.enabled ?? true,
          updatedBy,
        },
        create: {
          key: item.key,
          value: toJsonValue(item.value),
          enabled: item.enabled ?? true,
          updatedBy,
          type: meta[i].type,
          label: meta[i].label,
        },
      })
    )
  );

  for (const item of items) {
    cache.delete(item.key);
  }
}

// ============================================================
// 新增动态配置（自定义 key）
// ============================================================

/**
 * 创建动态配置项（仅管理员，key 必须全新）。
 *
 * 【与 setConfig 的区别】
 * - setConfig：编辑「已存在」的配置项（注册表项或动态项），key 不可改；
 * - createConfig：新增一个「全新」的 key，严格校验唯一性（注册表 + DB 均不得占用），
 *   不允许覆盖已存在的 key。
 *
 * 【校验顺序】
 * 1. key 命名格式（见名知意：全小写、点分）；
 * 2. key 唯一性（注册表内建项 + DB 已有动态项均冲突即拒绝）；
 * 3. 类型白名单 + 值类型校验（复用 validateValueByType）。
 *
 * @param params    - { key, type, value, label?, description?, enabled? }
 * @param updatedBy - 修改人 userId（可选，用于审计）
 * @throws key 格式非法 / key 已存在 / 值类型不符时抛出中文错误
 */
export async function createConfig(
  params: {
    key: string;
    type: ConfigType;
    value: unknown;
    label?: string;
    description?: string;
    enabled?: boolean;
  },
  updatedBy?: string
): Promise<void> {
  const { key, type, value, label, enabled = true } = params;

  // 0. 类型白名单校验（type 来自前端输入，须防非法值绕过校验）
  const VALID_TYPES: ConfigType[] = [
    "string",
    "textarea",
    "number",
    "boolean",
    "json",
    "json-array",
    "file",
  ];
  if (!VALID_TYPES.includes(type)) {
    throw new ConfigValidationError(`配置类型「${type}」不合法`);
  }

  // 1. key 命名格式校验
  if (!isValidConfigKey(key)) {
    throw new ConfigValidationError(
      `配置键「${key}」不合法：请用全小写、点分命名（仅限小写字母/数字/下划线，段间用点分隔），如 "feature.my_flag"`
    );
  }

  // 2. 唯一性校验：注册表内建项 / DB 已有动态项均不允许重复新增
  if (findConfig(key)) {
    throw new ConfigValidationError(`配置键「${key}」已被系统内置配置占用，请换一个 key`);
  }
  const existing = await prisma.systemConfig.findUnique({ where: { key } });
  if (existing) {
    throw new ConfigValidationError(`配置键「${key}」已存在，不能重复新增`);
  }

  // 3. 类型 + 值校验
  validateValueByType(type, label ?? key, value);

  // 4. 落库（key 唯一性由 DB 主键兜底）
  await prisma.systemConfig.create({
    data: {
      key,
      type,
      label: label ?? null,
      value: toJsonValue(value),
      enabled,
      updatedBy,
    },
  });

  cache.delete(key);
}

// ============================================================
// 恢复默认
// ============================================================

/**
 * 恢复单个配置项为默认值（删除覆盖行 + 失效缓存）。
 *
 * @param key - 配置键
 */
export async function resetConfig(key: string): Promise<void> {
  await prisma.systemConfig.deleteMany({ where: { key } });
  cache.delete(key);
}

/**
 * 恢复全部配置项为默认值（清空覆盖表 + 清空缓存）。
 */
export async function resetAllConfigs(): Promise<void> {
  await prisma.systemConfig.deleteMany({});
  cache.clear();
}
