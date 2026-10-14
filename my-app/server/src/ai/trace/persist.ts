/**
 * ============================================
 * AI Trace 持久化（Trace Persistence）
 * ============================================
 *
 * 【职责】
 * 把一次 AI 执行（run）及其节点级事件写入 PostgreSQL，
 * 并提供历史查询接口，实现「决策过程可回放」。
 *
 * 【为什么在这里统一落库】
 * trace 事件在节点执行时同步写入内存（见 tracer.ts 的 ALS 隔离），
 * 图执行结束后由路由层调用 saveTraceRun 一次性批量落库。
 * 好处：
 *   1. 不侵入节点代码（collectTrace 保持同步）；
 *   2. 一次 run 一条事务，原子性好；
 *   3. 避免每个节点都打一次数据库，减少 IO。
 *
 * 【JSON 序列化安全】
 * 节点的 input/output 是 unknown，可能含不可序列化的值
 * （循环引用、undefined、函数等）。落库前用 toJson 做深拷贝
 * 序列化验证，失败时降级为 null，绝不因脏数据导致落库崩溃。
 */

import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma.js";
import type { TraceEvent } from "./tracer.js";

/** 图类型：简历分析 / 知识库问答 / 职位发现 */
export type TraceRunType = "resume" | "rag" | "jobs";

/** 执行状态 */
export type TraceRunStatus = "success" | "error";

/**
 * 将任意值安全转为可存入 JSON 字段的值。
 *
 * 通过 JSON.stringify + JSON.parse 做一次「深拷贝 + 可序列化校验」：
 * - 普通对象/数组/字符串/数字 → 原样返回；
 * - undefined → null；
 * - 循环引用 / 不可序列化 → null；
 * - 对象内的 undefined 属性被丢弃（与 JSON 语义一致）。
 */
function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  // null/undefined 归一为 undefined：Prisma 会省略该字段，数据库存 NULL
  if (value === null || value === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  } catch {
    // 循环引用等极端情况：降级为 undefined，保证落库不崩
    return undefined;
  }
}

/** saveTraceRun 的参数 */
export interface SaveTraceRunParams {
  /** 本次执行唯一 ID（路由层生成） */
  runId: string;
  /** 归属用户 */
  userId: string;
  /** 图类型 */
  type: TraceRunType;
  /** 执行结果 */
  status: TraceRunStatus;
  /** 本次收集到的节点事件（可空数组） */
  events: TraceEvent[];
}

/**
 * 批量落库一次 run 及其全部节点事件。
 *
 * 用嵌套写入（run.create + events.create）保证一个事务内完成：
 * run 与 events 要么全部写入，要么全部失败。
 */
export async function saveTraceRun(params: SaveTraceRunParams): Promise<void> {
  const { runId, userId, type, status, events } = params;

  // 总耗时 = 各节点耗时之和（events 可能为空，此时为 0）
  const totalDurationMs = events.reduce((sum, e) => sum + e.durationMs, 0);

  await prisma.traceRun.create({
    data: {
      id: runId,
      userId,
      type,
      status,
      nodeCount: events.length,
      totalDurationMs,
      events: {
        create: events.map((e, order) => ({
          nodeName: e.nodeName,
          order,
          input: toJson(e.input),
          output: toJson(e.output),
          durationMs: e.durationMs,
          timestamp: e.timestamp,
        })),
      },
    },
  });
}

/** 历史列表项（不含 events，轻量） */
export interface TraceRunListItem {
  id: string;
  type: string;
  status: string;
  nodeCount: number;
  totalDurationMs: number;
  createdAt: Date;
}

/**
 * 列出用户最近的 trace run（不含事件详情，轻量分页）。
 *
 * @param userId - 归属用户
 * @param limit  - 返回条数上限，默认 20
 */
export async function listTraceRuns(
  userId: string,
  limit = 20
): Promise<TraceRunListItem[]> {
  return prisma.traceRun.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      type: true,
      status: true,
      nodeCount: true,
      totalDurationMs: true,
      createdAt: true,
    },
  });
}

/**
 * 查询单次 run 的完整详情（含按顺序排列的事件）。
 *
 * @param userId - 归属用户（越权防护：只能查自己的）
 * @param runId  - run ID
 * @returns run + events，找不到或无权访问返回 null
 */
export async function getTraceRun(userId: string, runId: string) {
  return prisma.traceRun.findFirst({
    where: { id: runId, userId },
    include: {
      events: { orderBy: { order: "asc" } },
    },
  });
}
