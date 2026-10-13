/**
 * ============================================
 * AI Trace 收集器（P6 落库版：AsyncLocalStorage 隔离）
 * ============================================
 *
 * 【职责】
 * 记录 LangGraph 图执行过程中的节点事件，供 AI Trace 面板消费，
 * 并由路由层在本次执行结束后批量落库（见 trace/persist.ts）。
 *
 * 【P6 变更：从全局内存单例 → AsyncLocalStorage 隔离】
 * P1 阶段用全局数组缓冲，存在两个已知缺陷：
 *   1. 多个并发请求会互相串味（全局单例没有归属概念）；
 *   2. 刷新即丢、无法回放历史。
 *
 * P6 改用 Node 的 AsyncLocalStorage（ALS）实现「请求级」隔离：
 *   - 每次 AI 执行调用 runWithTrace(runId, fn) 包裹；
 *   - collectTrace 内部通过 als.getStore() 拿到当前 run 的缓冲，
 *     把事件写入「本 run」，而不是全局数组；
 *   - ALS 的 context 沿 async/await 链传播，天然并发安全，
 *     两个同时进行的请求各写各的，互不干扰。
 *
 * 【事件结构】
 * { nodeName, input, output, durationMs, timestamp }
 *
 * 【兼容性】
 * collectTrace 的签名保持不变，三个图的 nodes.ts 无需任何改动。
 */

import { AsyncLocalStorage } from "node:async_hooks";

/** 单个节点执行事件的追踪记录 */
export interface TraceEvent {
  /** 节点名称，如 "parse"、"analyze"、"retrieve" */
  nodeName: string;
  /** 节点输入（P1 保留完整数据，供面板回放） */
  input: unknown;
  /** 节点输出（P1 保留完整数据，供面板回放） */
  output: unknown;
  /** 节点耗时（毫秒） */
  durationMs: number;
  /** 事件发生时间（ISO 8601 字符串） */
  timestamp: string;
}

/** 一次 run 的上下文：runId + 事件缓冲 */
interface RunStore {
  runId: string;
  events: TraceEvent[];
}

/** 请求级 trace 上下文（每个 run 一个独立 store，互不干扰） */
const als = new AsyncLocalStorage<RunStore>();

/**
 * 将任意值转为可安全打印的脱敏字符串。
 *
 * 只用于 console 日志，与内存中保存的完整数据无关。
 * 规则：
 * 1. 字符串超长时截断，并标注总长度；
 * 2. 对象序列化失败时兜底为占位符；
 * 3. 本模块从不接触 Key，因此天然不会泄露 Key 明文。
 */
function redactForLog(value: unknown, maxLength = 120): string {
  if (typeof value === "string") {
    return value.length > maxLength
      ? `${value.slice(0, maxLength)}…(共${value.length}字)`
      : value;
  }

  if (value === null || value === undefined) {
    return String(value);
  }

  try {
    const json = JSON.stringify(value);
    return json.length > maxLength
      ? `${json.slice(0, maxLength)}…(共${json.length}字符)`
      : json;
  } catch {
    return "[无法序列化]";
  }
}

/**
 * 收集一条节点事件。
 *
 * 【P6 行为】
 * 1. 若处于某个 run 的上下文中（ALS store 存在），写入该 run 的事件缓冲；
 * 2. 若不在任何 run 上下文（理论上不会发生，防御性兜底），仅打日志、不写入；
 * 3. console 打印脱敏摘要（方便开发期观察，不含 Key）。
 */
export function collectTrace(event: TraceEvent): void {
  const store = als.getStore();
  if (store) {
    store.events.push(event);
  }
  console.log(
    `[AI-Trace] 节点=${event.nodeName} 耗时=${event.durationMs}ms ` +
      `input=${redactForLog(event.input)} output=${redactForLog(event.output)}`
  );
}

/** runWithTrace 的返回结果：业务结果 + 本次收集到的全部事件 */
export interface TraceRunResult<T> {
  /** 业务函数 fn 的返回值 */
  result: T;
  /** 本次 run 内收集到的节点事件（按发生顺序） */
  events: TraceEvent[];
}

/**
 * 在独立的 trace 上下文中执行一段业务逻辑，并返回其收集到的事件。
 *
 * 用法（路由层）：
 *   const { result, events } = await runWithTrace(runId, async () => {
 *     const stream = await graph.stream(...);
 *     for await (...) { ... }
 *     return { ...finalResult };
 *   });
 *   await saveTraceRun({ runId, ..., events });
 *
 * @param runId - 本次执行唯一 ID（路由层生成，用于落库关联）
 * @param fn     - 业务函数（图执行 + 结果收集），async
 * @returns      业务结果 + 本次事件列表
 */
export async function runWithTrace<T>(
  runId: string,
  fn: () => Promise<T>
): Promise<TraceRunResult<T>> {
  const store: RunStore = { runId, events: [] };
  // als.run 支持异步回调：fn 返回的 Promise 会被透传并 await，
  // 整个 async 链路上的 collectTrace 都能拿到当前 store。
  const result = await als.run(store, fn);
  return { result, events: store.events };
}
