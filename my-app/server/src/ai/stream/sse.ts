/**
 * ============================================
 * SSE（Server-Sent Events）流式通道封装
 * ============================================
 *
 * 【职责】
 * 把 LangGraph 的流式事件（token 流 / 节点事件 / trace 事件）转成
 * 标准 SSE 格式写回客户端，用于实现"打字机式"的逐 token 输出。
 *
 * 【SSE 格式】
 * 每条事件由若干行组成，事件之间用空行分隔：
 *   event: token\n
 *   data: {"token":"你"}\n
 *   \n
 * 客户端（EventSource / fetch 流式读取）据此解析事件类型与负载。
 */

import type { Response } from "express";

/** 一条待发送的 SSE 事件 */
export interface SSEMessage {
  /** 事件类型，如 token / node / trace / done / error / meta */
  event: string;
  /** 事件负载，发送前会被 JSON.stringify */
  data: unknown;
  /** 可选的事件 ID（P1 未使用，预留） */
  id?: string;
}

/** SSE 写入器，供路由层调用 */
export interface SSEWriter {
  /** 发送一条 SSE 事件 */
  send(event: string, data: unknown): void;
  /** 关闭响应流（结束后必须调用，否则连接会挂起） */
  close(): void;
  /** 是否已关闭（客户端断开或调用 close 后为 true） */
  readonly closed: boolean;
}

/**
 * 创建一个 SSE 写入器。
 *
 * @param res - Express 的 Response 对象
 * @returns SSEWriter 实例
 *
 * 【注意】
 * 必须在写任何响应内容之前调用本函数（它会立即发送响应头）。
 * 因此路由层应先完成参数校验、Key 校验等 JSON 错误分支，
 * 确认进入流式阶段后才调用本函数。
 */
export function createSSEWriter(res: Response): SSEWriter {
  // ---------- 设置 SSE 响应头并立即发送 ----------
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // 禁用 Nginx 等反向代理的缓冲，保证 token 实时推送到客户端
    "X-Accel-Buffering": "no",
  });

  // 关闭标记：防止往已断开的 socket 继续写入导致异常
  let closed = false;

  // 客户端主动断开时置为关闭，后续 send 直接忽略
  res.on("close", () => {
    closed = true;
  });

  /**
   * 发送一条 SSE 事件。
   *
   * 格式：event 行 + data 行（JSON）+ 空行。
   * data 为 null/undefined 时统一序列化为 "null"，保证格式合法。
   */
  function send(event: string, data: unknown): void {
    if (closed) {
      return;
    }

    let payload: string;
    try {
      payload = JSON.stringify(data ?? null);
    } catch {
      // 极端情况下负载无法序列化，降级为空对象，避免整条流中断
      payload = "{}";
    }

    res.write(`event: ${event}\n`);
    res.write(`data: ${payload}\n\n`);
  }

  /**
   * 关闭响应流。
   *
   * 幂等：重复调用只会生效一次。结束 SSE 时必须调用，否则连接会一直挂起。
   */
  function close(): void {
    if (closed) {
      return;
    }
    closed = true;
    res.end();
  }

  return {
    send,
    close,
    get closed(): boolean {
      return closed;
    },
  };
}
