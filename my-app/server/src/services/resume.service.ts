/**
 * ============================================
 * 简历服务模块（Resume Service）
 * ============================================
 *
 * 【职责】
 * 1. 解析简历文件（PDF/DOCX/TXT）为纯文本
 * 2. 首轮 AI 优化（评分 + 标签 + 建议 + 优化版）
 * 3. 对话式迭代修改（携带上下文 + 聚焦段落）
 */

import mammoth from "mammoth";
import PDFParser from "pdf2json";

// ========== 类型定义 ==========

export interface ParseResult {
  text: string;
  wordCount: number;
}

export interface ResumeTag {
  label: string;
  type: "positive" | "warning" | "negative";
}

export interface ResumeSuggestion {
  category: string;
  original: string;
  suggestion: string;
  improved: string;
}

export interface ChangeItem {
  section: string;
  original: string;
  improved: string;
  reason: string;
}

export interface OptimizeResult {
  score: number;
  tags: ResumeTag[];
  highlights: string[];
  suggestions: ResumeSuggestion[];
  optimized: string;
}

export interface ChatResult {
  optimized: string;
  changes: ChangeItem[];
  reply: string;
  conversationId: string;
}

/**
 * 本链路单次模型调用的参数（由装配层从配置中心读出后传入）。
 *
 * 历史上这些值全部硬编码在本文件里，导致「系统设置」里改配置对简历优化
 * 完全无效；现在统一从这里注入，与 LangGraph 链路保持一致。
 */
export interface ResumeLlmOptions {
  model: string;
  temperature: number;
  maxTokens: number;
  timeout: number;
  /** 是否开启深度思考（思考过程经 reasoning_content 返回） */
  thinking: boolean;
  /** 思考强度档位（仅 thinking 为 true 时下发） */
  reasoningEffort?: string;
}

// ========== 文件解析 ==========

/**
 * 解析上传的简历文件为纯文本
 */
export async function parseResume(
  buffer: Buffer,
  mimeType: string
): Promise<ParseResult> {
  let text = "";

  // TXT 文件：直接转字符串
  if (mimeType === "text/plain") {
    text = buffer.toString("utf-8");
  }
  // DOCX 文件：用 mammoth 提取文本
  else if (
    mimeType ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const result = await mammoth.extractRawText({ buffer });
    text = result.value;
  }
  // PDF 文件：用 pdf2json 解析
  else if (mimeType === "application/pdf") {
    text = await parsePdf(buffer);
  } else {
    throw new Error("不支持的文件格式，请上传 PDF、DOCX 或 TXT 文件");
  }

  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("未能从文件中提取到文本内容");
  }

  return {
    text: trimmed,
    wordCount: trimmed.split(/\s+/).length,
  };
}

/**
 * 安全解码 URI 组件
 *
 * PDF 文件中可能含有二进制垃圾、损坏的字符等。
 * 标准 decodeURIComponent 在遇到非法序列时会抛 URIError，
 * 用 try-catch 兜底，遇到坏数据时返回原文（保留原样）。
 */
function safeDecodeURI(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** PDF 解析（pdf2json 是回调风格，用 Promise 包装） */
function parsePdf(buffer: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const parser = new PDFParser();
    parser.on("pdfParser_dataReady", (data: any) => {
      try {
        const pages = data.Pages || [];
        const lines: string[] = [];
        for (const page of pages) {
          for (const textObj of page.Texts || []) {
            const line = textObj.R
              ?.map((r: any) => safeDecodeURI(r.T || ""))
              .join("");
            if (line) lines.push(line);
          }
        }
        resolve(lines.join("\n"));
      } catch (e) {
        reject(e);
      }
    });
    parser.on("pdfParser_dataError", reject);
    parser.parseBuffer(buffer);
  });
}

// ========== DeepSeek 接口调用 ==========

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";

/**
 * 调用 DeepSeek 接口
 *
 * @param systemPrompt - 系统提示词
 * @param userPrompt   - 用户提示词
 * @param temperature  - 采样温度
 * @param apiKey       - 明文 API Key（由控制器从用户配置中解密后传入）
 *
 * 【密钥来源变更说明】
 * 之前 apiKey 是模块级常量（读环境变量），现在改为运行时参数传入，
 * 由调用方（resume.controller）从"当前登录用户的配置"中解密获取，
 * 实现按用户隔离，不再依赖写死的环境变量。
 */
async function callDeepSeek(
  systemPrompt: string,
  userPrompt: string,
  options: ResumeLlmOptions,
  apiKey: string
): Promise<string> {
  return callDeepSeekMessages(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    options,
    apiKey
  );
}

/**
 * 非流式调用（消息数组入参）。
 *
 * 与 callDeepSeek 的差别只有一个：它接受完整的消息数组，因此可以携带
 * 对话历史 —— 多轮对话修改走这条。
 */
async function callDeepSeekMessages(
  messages: { role: string; content: string }[],
  options: ResumeLlmOptions,
  apiKey: string
): Promise<string> {
  if (!apiKey) {
    throw new Error("未配置 DeepSeek API Key");
  }

  // 打印调用参数（脱敏，绝不打印完整 Key）
  console.log(
    `[DeepSeek] 开始调用 model=${options.model} thinking=${options.thinking} messages=${messages.length} key=sk-****${apiKey.slice(-4)}`
  );
  const startTime = Date.now();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeout);

  let res: Response;
  try {
    res = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: options.model,
        messages,
        // 思考模式下 temperature 被服务端忽略，故此时不下发
        ...(options.thinking ? {} : { temperature: options.temperature }),
        max_tokens: options.maxTokens,
        // 深度思考开关（DeepSeek 专有参数）
        thinking: { type: options.thinking ? "enabled" : "disabled" },
        ...(options.thinking && options.reasoningEffort
          ? { reasoning_effort: options.reasoningEffort }
          : {}),
      }),
      signal: controller.signal,
    });
  } catch (e: any) {
    clearTimeout(timer);
    const elapsed = Date.now() - startTime;
    if (e.name === "AbortError") {
      const seconds = Math.round(options.timeout / 1000);
      console.error(`[DeepSeek] 超时 (${elapsed}ms): ${seconds}秒内未响应`);
      throw new Error(`DeepSeek 请求超时 (${seconds}s)，请稍后重试`);
    }
    console.error(`[DeepSeek] 网络错误 (${elapsed}ms):`, e.message);
    throw new Error(`DeepSeek 网络请求失败: ${e.message}`);
  } finally {
    clearTimeout(timer);
  }

  const elapsed = Date.now() - startTime;
  console.log(`[DeepSeek] 响应 status=${res.status} time=${elapsed}ms`);

  /**
   * 先读取原始文本，再尝试解析 JSON
   * 避免 DeepSeek 返回非 JSON 错误（如 HTML 错误页）时直接抛 SyntaxError
   */
  const rawText = await res.text();

  if (!res.ok) {
    // 401/403 → 密钥无效
    // 402 → 余额不足
    // 429 → 限流
    console.error(
      `[DeepSeek] 失败 (${res.status}): ${rawText.slice(0, 300)}`
    );
    throw new Error(
      `DeepSeek 调用失败 (${res.status}): ${rawText.slice(0, 200)}`
    );
  }

  // 打印响应预览（脱敏）
  console.log(`[DeepSeek] 成功 output=${rawText.length}chars preview="${rawText.slice(0, 120)}..."`);

  let data: any;
  try {
    data = JSON.parse(rawText);
  } catch {
    console.error(`[DeepSeek] JSON 解析失败 raw="${rawText.slice(0, 200)}"`);
    throw new Error(`DeepSeek 返回了非 JSON 数据: ${rawText.slice(0, 200)}`);
  }

  const content = data.choices?.[0]?.message?.content || "";
  return content;
}

// ========== 首轮 AI 优化 ==========

const OPTIMIZE_SYSTEM_PROMPT = `你是资深 HR + 简历优化专家。分析以下简历并按 JSON 格式返回, 不要包含任何 markdown 代码块标记:

{
  "score": 0-100,
  "tags": [{ "label": "标签名", "type": "positive" }],
  "highlights": ["亮点1", "亮点2"],
  "suggestions": [{
    "category": "格式|内容|关键词|量化数据|语法",
    "original": "需要修改的原文片段",
    "suggestion": "为什么需要修改",
    "improved": "修改后的文本"
  }],
  "optimized": "完整的优化后简历(Markdown格式)"
}

评分标准: 格式完整性20分 + 关键词丰富度25分 + 量化数据25分 + 语法规范15分 + 结构清晰15分

【输出格式硬性要求】
1. 只输出一个 JSON 对象, 前后不要任何解释文字, 不要 markdown 代码围栏;
2. optimized 字段是一整段 Markdown 文本, 其中的换行必须写成 \\n 转义, 不要直接敲回车;
3. 字符串内的双引号必须转义为 \\".`;

/**
 * 修掉 JSON「字符串值内部」的裸换行与制表符。
 *
 * 结构化输出要求换行写成 \n，但模型在写长 Markdown（简历正文）时高频直接
 * 敲回车，JSON.parse 会报 "Bad control character"。
 *
 * 必须逐字符扫描、只在字符串值内部替换：JSON 的格式化换行（字段之间）
 * 是合法空白，一刀切 replace 会把结构搞坏。
 */
function escapeRawControlCharsInStrings(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;

  for (const ch of text) {
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      out += ch;
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      out += ch;
      continue;
    }
    if (inString && ch === "\n") {
      out += "\\n";
      continue;
    }
    if (inString && ch === "\r") {
      continue;
    }
    if (inString && ch === "\t") {
      out += "\\t";
      continue;
    }
    out += ch;
  }

  return out;
}

/**
 * 从模型输出里稳健地抠出 JSON 对象，失败返回 null。
 *
 * 【为什么不能直接 JSON.parse】
 * 即使 Prompt 明确要求「不要 markdown 代码块标记」，模型仍会：
 * 1. 习惯性包一层 ```json 围栏；
 * 2. 在 JSON 前后加一句「以下是优化结果：」之类的寒暄；
 * 3. 在字符串值里写未转义的换行 —— 写 Markdown 简历时几乎必然发生。
 * 三者都会让裸 JSON.parse 抛错。旧代码的兜底是「把原文当结果返回」，
 * 于是用户会在简历预览里看到一整坨 JSON（这是一个真实发生过的线上问题）。
 */
function parseModelJson(raw: string): Record<string, unknown> | null {
  const text = raw.trim();
  if (!text) return null;

  // 第 1 步：剥离 ```json ... ``` / ``` ... ``` 围栏
  const fenced = text
    .replace(/^```[a-zA-Z]*\s*/, "")
    .replace(/```\s*$/, "")
    .trim();

  // 第 2 步：截取第一个 { 到最后一个 }，去掉前后的寒暄文字
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  const candidate =
    start >= 0 && end > start ? fenced.slice(start, end + 1) : fenced;

  // 第 3 步：逐级降级重试 —— 先原样，再修串内控制字符
  for (const attempt of [
    candidate,
    escapeRawControlCharsInStrings(candidate),
  ]) {
    try {
      const parsed = JSON.parse(attempt);
      if (parsed && typeof parsed === "object") {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // 换下一种修法继续试
    }
  }

  return null;
}

/**
 * 判断模型输出是否「被输出长度截断」。
 *
 * 判据：去掉尾部空白后没有闭合的 `}`。JSON 对象的最后一个字符必然是 `}`，
 * 缺了就说明写到一半被 max_tokens 砍掉了 —— 它与「格式污染」的处理建议
 * 完全不同：前者要调低推理强度或调高长度上限，后者重试就好。
 */
function isLikelyTruncated(raw: string): boolean {
  return !raw.trimEnd().endsWith("}");
}

/**
 * 打印无法解析的模型输出（截断保存），用于事后定位故障类型。
 *
 * head 用来判断有没有被围栏/寒暄污染，tail 用来判断有没有被截断 ——
 * 这两个位置足以覆盖绝大多数失败场景，不必把整段输出写进日志。
 */
function logUnparsableOutput(scene: string, raw: string): void {
  const truncated = isLikelyTruncated(raw);
  console.error(
    `[resume] ${scene}结果无法解析为 JSON（疑似${truncated ? "被输出长度截断" : "格式污染"}）` +
      ` content=${raw.length}chars head="${raw.slice(0, 80)}" tail="${raw.slice(-80)}"`
  );
}

/** 按「截断 / 污染」给出不同的可执行建议 */
function buildUnparsableMessage(raw: string, prefix: string): string {
  return isLikelyTruncated(raw)
    ? `${prefix}：AI 输出被长度上限截断，内容没生成完整。请重试；若反复出现，请在系统设置中把「简历优化思考强度」调为 low，或关闭「深度思考」`
    : `${prefix}：格式异常，请重试；若反复出现，可在系统设置中关闭「深度思考」后再试`;
}

/**
 * 把模型返回的原始文本解析成首轮优化结果。
 *
 * 【为什么解析失败要抛错而不是兜底】
 * 兜底成「原文」会让用户在预览里看到原始简历或一整坨 JSON，却配着
 * 「优化完成、综合评分 70 分」的成功态——用户完全无从判断出了什么问题。
 * 宁可直接报错让用户重试。
 */
function parseOptimizeResult(raw: string): OptimizeResult {
  const parsed = parseModelJson(raw);

  if (!parsed) {
    logUnparsableOutput("优化", raw);
    throw new Error(buildUnparsableMessage(raw, "AI 返回的结果异常"));
  }

  // optimized 缺失同样不能静默顶上原文，否则又是「看起来成功其实没改」
  const optimized =
    typeof parsed.optimized === "string" ? parsed.optimized.trim() : "";
  if (!optimized) {
    console.error(
      `[resume] 模型输出缺少 optimized 字段 keys=${Object.keys(parsed).join(",")}`
    );
    throw new Error("AI 返回的结果缺少简历正文，请重试");
  }

  return {
    // Number() 兼容模型偶尔把分数写成字符串 "75"
    score: Number(parsed.score) || 70,
    tags: Array.isArray(parsed.tags) ? parsed.tags : [],
    highlights: Array.isArray(parsed.highlights) ? parsed.highlights : [],
    suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
    optimized,
  };
}

export async function optimizeResume(
  resumeText: string,
  options: ResumeLlmOptions,
  apiKey: string
): Promise<OptimizeResult> {
  /**
   * 无 Key 时直接抛错，由控制器拦截并返回明确提示，
   * 不再回退到 Mock 数据（避免静默失败、避免用户误以为 AI 生效）。
   */
  if (!apiKey) {
    throw new Error(
      "需先在个人中心配置 DeepSeek API Key 才能使用 AI 简历优化"
    );
  }

  const raw = await callDeepSeek(
    OPTIMIZE_SYSTEM_PROMPT,
    resumeText,
    options,
    apiKey
  );

  // 空正文必须报错，不能交给 parseOptimizeResult 兜底成"原文"
  assertNonEmptyContent(raw);
  return parseOptimizeResult(raw);
}

/**
 * 向 DeepSeek 发起**流式**请求，逐块回调思考增量，返回累积的正文全文。
 *
 * 首轮优化与对话修改共用这一份实现（两者只差 system prompt 与消息内容）。
 *
 * 【为什么能流式思考但流式不了正文】
 * 这两条链路的输出都是一个 JSON（optimized 字段才是简历全文），JSON 必须
 * 等完整才能解析，所以正文无法逐字渲染；而思考过程是独立的 reasoning_content
 * 流，可以逐字推给前端——这正是「深度思考逐字流式」的落点。
 *
 * 【实现要点】
 * - DeepSeek 的 OpenAI 兼容流是标准 SSE：每行 `data: {json}`，以 `data: [DONE]` 收尾；
 * - 逐行解析时最后一行可能不完整，必须留在 buffer 里等下一块；
 * - 单个 JSON 解析失败只跳过该行，不中断整条流（避免一个坏包毁掉整次输出）；
 * - 超时定时器覆盖「建连 + 整个流读取」全程，由 finally 统一清理。
 *
 * @param messages         - 完整消息数组（system + user + history）
 * @param onReasoningDelta - 每收到一小段思考内容就回调一次（可能是几个字）
 * @returns 模型产出的正文全文（不含思考过程）
 */
async function streamDeepSeek(
  messages: { role: string; content: string }[],
  options: ResumeLlmOptions,
  apiKey: string,
  onReasoningDelta: (delta: string) => void
): Promise<string> {
  const controller = new AbortController();
  // 定时器覆盖「建连 + 整个流读取」全程，由 finally 统一清理
  const timer = setTimeout(() => controller.abort(), options.timeout);

  try {
    const res = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: options.model,
        messages,
        ...(options.thinking ? {} : { temperature: options.temperature }),
        max_tokens: options.maxTokens,
        stream: true,
        thinking: { type: options.thinking ? "enabled" : "disabled" },
        ...(options.thinking && options.reasoningEffort
          ? { reasoning_effort: options.reasoningEffort }
          : {}),
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const rawText = await res.text();
      console.error(`[DeepSeek] 流式失败 (${res.status}): ${rawText.slice(0, 300)}`);
      throw new Error(
        `DeepSeek 调用失败 (${res.status}): ${rawText.slice(0, 200)}`
      );
    }
    if (!res.body) {
      throw new Error("DeepSeek 未返回流式响应体");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    let reasoningChars = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // 按行切分：最后一段可能是不完整的行，留到下一块再拼
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        // 忽略空行与 SSE 注释行（以 ":" 开头）
        if (!trimmed.startsWith("data:")) continue;

        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;

        let chunk: {
          choices?: Array<{
            delta?: { reasoning_content?: string; content?: string };
          }>;
        };
        try {
          chunk = JSON.parse(payload);
        } catch {
          // 残缺包直接跳过：下一条通常仍可解析，不中断整条流
          continue;
        }

        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;

        if (typeof delta.reasoning_content === "string" && delta.reasoning_content) {
          reasoningChars += delta.reasoning_content.length;
          onReasoningDelta(delta.reasoning_content);
        }
        if (typeof delta.content === "string" && delta.content) {
          content += delta.content;
        }
      }
    }

    console.log(
      `[DeepSeek] 流式完成 content=${content.length}chars reasoning=${reasoningChars}chars`
    );

    return content;
  } catch (e) {
    const err = e as Error;
    if (err.name === "AbortError") {
      const seconds = Math.round(options.timeout / 1000);
      throw new Error(`DeepSeek 请求超时 (${seconds}s)，请稍后重试`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 正文为空即视为失败 —— 这一步是**必须**的，不能省。
 *
 * 【为什么不能让它静默降级】
 * parseXxxResult 的兜底逻辑是「解析不出来就把原文当结果」，这对「模型返回了
 * 半截内容」是合理的，但对「正文完全是空」是灾难：
 * 用户会看到「优化完成」，而界面上那份简历其实是**原始简历**，评分还是默认的
 * 70 分，完全察觉不到 AI 什么都没做。
 *
 * 【最常见的成因】
 * 思考 token 也计入 max_tokens。若 max_tokens 不够，模型会把额度全花在推理上、
 * 正文一个字都吐不出来（实测日志：content=0chars reasoning=7978chars）。
 * 装配层已通过 THINKING_MAX_TOKENS_FLOOR 抬高了上限，这里做最后一道防线。
 */
function assertNonEmptyContent(content: string): void {
  if (!content.trim()) {
    throw new Error(
      "模型未返回有效内容（深度思考可能耗尽了输出长度），请重试，或关闭「深度思考」后再试一次"
    );
  }
}

/**
 * 首轮优化（流式版）：思考过程逐字回调，结构化结果在流结束后返回。
 *
 * @param onReasoningDelta - 每收到一小段思考内容就回调一次（可能是几个字）
 */
export async function streamOptimizeResume(
  resumeText: string,
  options: ResumeLlmOptions,
  apiKey: string,
  onReasoningDelta: (delta: string) => void
): Promise<OptimizeResult> {
  if (!apiKey) {
    throw new Error(
      "需先在个人中心配置 DeepSeek API Key 才能使用 AI 简历优化"
    );
  }

  const content = await streamDeepSeek(
    [
      { role: "system", content: OPTIMIZE_SYSTEM_PROMPT },
      { role: "user", content: resumeText },
    ],
    options,
    apiKey,
    onReasoningDelta
  );

  // 空正文必须报错，不能交给 parseOptimizeResult 兜底成"原文"
  assertNonEmptyContent(content);
  return parseOptimizeResult(content);
}

// ========== 对话式迭代优化 ==========

const CHAT_SYSTEM_PROMPT = `你是专业的简历优化顾问。用户会告诉你需要修改简历的哪些部分, 你只需根据用户的要求修改简历, 保持其它部分不变。

返回 JSON（不要 markdown 代码块标记）:
{
  "optimized": "根据要求修改后的完整简历(Markdown)",
  "changes": [{
    "section": "被修改的段落名称",
    "original": "修改前的文本(截取前50字)",
    "improved": "修改后的文本(截取前50字)",
    "reason": "一句话解释为什么这样改"
  }],
  "reply": "你的回复, 要像真人顾问一样简短自然(1-2句话)"
}

【输出格式硬性要求】
1. 只输出一个 JSON 对象, 前后不要任何解释文字, 不要 markdown 代码围栏;
2. optimized 字段是一整段 Markdown 文本, 其中的换行必须写成 \\n 转义, 不要直接敲回车;
3. 字符串内的双引号必须转义为 \\".`;

export async function chatResume(
  resumeText: string,
  message: string,
  options: ResumeLlmOptions,
  history?: { role: string; content: string }[],
  sectionContext?: { section: string; originalText: string },
  apiKey?: string
): Promise<ChatResult> {
  // 无 Key 时抛错（不再回退 Mock）
  if (!apiKey) {
    throw new Error(
      "需先在个人中心配置 DeepSeek API Key 才能使用 AI 对话修改"
    );
  }

  const content = await callDeepSeekMessages(
    buildChatMessages(resumeText, message, history, sectionContext),
    options,
    apiKey
  );

  // 空正文必须报错，不能静默降级成"已修改"（内容其实没动）
  assertNonEmptyContent(content);
  return parseChatResult(content);
}

/**
 * 组装对话修改的消息数组。
 *
 * 结构：system 人设 → user（当前简历 + 可选聚焦段落 + 本次要求）→ 历史消息。
 * 把当前简历放进 user 而不是 system，是为了让它对模型呈现为"待处理的数据"。
 */
function buildChatMessages(
  resumeText: string,
  message: string,
  history?: { role: string; content: string }[],
  sectionContext?: { section: string; originalText: string }
): { role: string; content: string }[] {
  const messages: { role: string; content: string }[] = [
    { role: "system", content: CHAT_SYSTEM_PROMPT },
  ];

  const contextStr = sectionContext
    ? `当前简历:\n${resumeText}\n\n用户聚焦的段落: ${sectionContext.section}\n段落原文: ${sectionContext.originalText}\n\n用户消息: ${message}`
    : `当前简历:\n${resumeText}\n\n用户消息: ${message}`;

  messages.push({ role: "user", content: contextStr });

  if (history && history.length > 0) {
    messages.push(
      ...history.map((h) => ({
        role: h.role as "user" | "assistant",
        content: h.content,
      }))
    );
  }

  return messages;
}

/**
 * 把对话修改返回的原始文本解析成结果。
 *
 * 与 parseOptimizeResult 一致：解析失败直接抛错，绝不把原始 JSON 当简历返回。
 */
function parseChatResult(raw: string): ChatResult {
  const parsed = parseModelJson(raw);

  if (!parsed) {
    logUnparsableOutput("对话", raw);
    throw new Error(buildUnparsableMessage(raw, "AI 返回的结果异常"));
  }

  const optimized =
    typeof parsed.optimized === "string" ? parsed.optimized.trim() : "";
  if (!optimized) {
    console.error(
      `[resume] 对话结果缺少 optimized 字段 keys=${Object.keys(parsed).join(",")}`
    );
    throw new Error("AI 未返回修改后的简历正文，请重试");
  }

  const reply =
    typeof parsed.reply === "string" && parsed.reply.trim()
      ? parsed.reply.trim()
      : "已根据您的要求完成修改";

  return {
    optimized,
    changes: Array.isArray(parsed.changes) ? parsed.changes : [],
    reply,
    conversationId: `conv_${Date.now()}`,
  };
}

/**
 * 对话修改（流式版）：思考过程逐字回调，结果在流结束后返回。
 *
 * 与 streamOptimizeResume 共用 streamDeepSeek，只差消息组装与结果解析。
 */
export async function streamChatResume(
  resumeText: string,
  message: string,
  options: ResumeLlmOptions,
  apiKey: string,
  onReasoningDelta: (delta: string) => void,
  history?: { role: string; content: string }[],
  sectionContext?: { section: string; originalText: string }
): Promise<ChatResult> {
  if (!apiKey) {
    throw new Error(
      "需先在个人中心配置 DeepSeek API Key 才能使用 AI 对话修改"
    );
  }

  const content = await streamDeepSeek(
    buildChatMessages(resumeText, message, history, sectionContext),
    options,
    apiKey,
    onReasoningDelta
  );

  assertNonEmptyContent(content);
  return parseChatResult(content);
}
