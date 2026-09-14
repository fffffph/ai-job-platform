/**
 * ============================================
 * 轻量 Trace 骨架（AI Trace Skeleton）
 * ============================================
 *
 * 【职责】
 * 记录 LangGraph 图执行过程中的节点事件，供后续 AI Trace 面板消费。
 * P1 阶段只做两件事：
 * 1. 内存收集事件（不落库，落库是 P6 的持久化任务）；
 * 2. console 打印脱敏信息（截断长文本、绝不打印 Key 明文）。
 *
 * 【事件结构】
 * { nodeName, input, output, durationMs, timestamp }
 *
 * 【P1 已知限制】
 * 当前为全局单例内存缓冲，多个并发请求会互相串味；
 * P6 落库时会改为按 runId（执行 ID）隔离，届时本模块 API 保持稳定。
 */

/** 单个节点执行事件的追踪记录 */
export interface TraceEvent {
  /** 节点名称，如 "parse"、"analyze" */
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

/** 内存 trace 缓冲（P1 用数组即可，P6 换持久化存储） */
const traceBuffer: TraceEvent[] = [];

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
 * 同时做两件事：
 * 1. 写入内存缓冲（getTrace 可读取）；
 * 2. console 打印脱敏摘要（方便开发期观察，不含 Key）。
 */
export function collectTrace(event: TraceEvent): void {
  traceBuffer.push(event);
  console.log(
    `[AI-Trace] 节点=${event.nodeName} 耗时=${event.durationMs}ms ` +
      `input=${redactForLog(event.input)} output=${redactForLog(event.output)}`
  );
}

/**
 * 获取当前内存中的全部 trace 事件。
 *
 * 返回的是浅拷贝数组，避免调用方意外修改内部缓冲。
 */
export function getTrace(): TraceEvent[] {
  return traceBuffer.map((event) => ({ ...event }));
}

/**
 * 清空内存 trace 缓冲。
 *
 * 每次流式执行开始前调用，避免上一轮的残留数据混入本轮。
 */
export function clearTrace(): void {
  traceBuffer.length = 0;
}
