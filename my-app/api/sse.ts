/**
 * ============================================
 * SSE（Server-Sent Events）流式读取工具
 * ============================================
 *
 * 【为什么不能用 axios？】
 * axios 默认会等整个响应体返回后才 resolve，无法实时读取
 * text/event-stream 的增量数据。因此 SSE 接口必须用原生 fetch
 * + ReadableStream 逐块读取，实现"打字机式"的实时渲染。
 *
 * 【后端 SSE 事件格式】
 * 后端（server/src/ai/stream/sse.ts）发送的每条事件格式如下：
 *   event: node\n
 *   data: {"nodeName":"retrieve",...}\n
 *   \n
 * 事件之间用空行（\n\n）分隔。data 可能是单行 JSON，也可能多行。
 *
 * 【使用方式】
 * const res = await fetch(url, {...});
 * await readSSEStream(res, (evt) => {
 *   if (evt.event === "token") { ... }
 *   const data = JSON.parse(evt.data);
 * });
 */

/** 一条已解析的 SSE 事件 */
export interface SSEEvent {
  /**
   * 事件类型：
   * token / node / trace / done / error / meta / progress / reasoning
   * （reasoning 为模型深度思考过程，见 server/src/routes/ai.routes.ts）
   */
  event: string;
  /** 事件负载（JSON 字符串，调用方自行 JSON.parse） */
  data: string;
}

/**
 * 读取 SSE 响应流，逐事件回调处理。
 *
 * @param response - fetch 返回的 Response 对象（必须是流式响应）
 * @param onEvent  - 每解析出一条事件就回调一次
 * @returns Promise，流结束时 resolve
 * @throws 响应体不支持流式读取时抛出
 */
export async function readSSEStream(
  response: Response,
  onEvent: (evt: SSEEvent) => void
): Promise<void> {
  // 响应体可能为空（如非 200 的 JSON 错误），此时无法流式读取
  if (!response.body) {
    throw new Error("响应不支持流式读取");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  // 缓冲区：累积未完整的事件块（跨 chunk 的事件需要拼接）
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    // 增量解码（stream: true 保证多字节字符不被截断）
    buffer += decoder.decode(value, { stream: true });

    // 按空行（\n\n）切分事件块，最后一段可能不完整，留到下一个 chunk
    const blocks = buffer.split(/\n\n/);
    buffer = blocks.pop() ?? "";

    for (const block of blocks) {
      const evt = parseSSEBlock(block);
      if (evt) {
        onEvent(evt);
      }
    }
  }

  // 处理流结束时残留的最后一块（可能没有结尾空行）
  if (buffer.trim()) {
    const evt = parseSSEBlock(buffer);
    if (evt) {
      onEvent(evt);
    }
  }
}

/**
 * 解析单个 SSE 事件块（一个 \n\n 之间的内容）。
 *
 * 块内可能包含：
 *   event: 类型名（可选，缺省为 "message"）
 *   data:  负载（可多行，用 \n 连接）
 *   id:    事件 ID（可选，本项目未使用）
 *
 * @param block - 单个事件块的原始文本
 * @returns 解析出的事件；若块内无 data 行则返回 null（如纯注释块）
 */
function parseSSEBlock(block: string): SSEEvent | null {
  let event = "message";
  const dataLines: string[] = [];

  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      // data 后面可能带一个空格（SSE 规范），去掉
      dataLines.push(line.slice(5).replace(/^ /, ""));
    }
    // id: 和注释行（: 开头）本项目不处理，忽略
  }

  if (dataLines.length === 0) {
    return null;
  }

  return {
    event,
    data: dataLines.join("\n"),
  };
}
