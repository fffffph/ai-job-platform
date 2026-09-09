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
  temperature: number,
  apiKey: string
): Promise<string> {
  if (!apiKey) {
    throw new Error("未配置 DeepSeek API Key");
  }

  // 打印 API Key 状态（脱敏，绝不打印完整 Key）
  console.log(
    `[DeepSeek] 开始调用 model=deepseek-chat temp=${temperature} key=sk-****${apiKey.slice(-4)} input=${userPrompt.length}chars`
  );
  const startTime = Date.now();

  // 30 秒超时：避免 DeepSeek 无响应时服务端连接永久挂起
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);

  let res: Response;
  try {
    res = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature,
        max_tokens: 4096,
      }),
      signal: controller.signal,
    });
  } catch (e: any) {
    clearTimeout(timer);
    const elapsed = Date.now() - startTime;
    if (e.name === "AbortError") {
      console.error(`[DeepSeek] 超时 (${elapsed}ms): 30秒内未响应`);
      throw new Error("DeepSeek 请求超时 (30s)，请稍后重试");
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

评分标准: 格式完整性20分 + 关键词丰富度25分 + 量化数据25分 + 语法规范15分 + 结构清晰15分`;

export async function optimizeResume(
  resumeText: string,
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

  const raw = await callDeepSeek(OPTIMIZE_SYSTEM_PROMPT, resumeText, 0.5, apiKey);

  try {
    const parsed = JSON.parse(raw);
    return {
      score: parsed.score || 70,
      tags: parsed.tags || [],
      highlights: parsed.highlights || [],
      suggestions: parsed.suggestions || [],
      optimized: parsed.optimized || resumeText,
    };
  } catch {
    // JSON 解析失败，返回原始文本作为兜底
    return {
      score: 70,
      tags: [],
      highlights: [],
      suggestions: [],
      optimized: raw || resumeText,
    };
  }
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
}`;

export async function chatResume(
  resumeText: string,
  message: string,
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

  // 构建完整的消息历史
  const messages: { role: string; content: string }[] = [
    { role: "system", content: CHAT_SYSTEM_PROMPT },
  ];

  // 首次发送时传入当前简历作为上下文
  const contextStr = sectionContext
    ? `当前简历:\n${resumeText}\n\n用户聚焦的段落: ${sectionContext.section}\n段落原文: ${sectionContext.originalText}\n\n用户消息: ${message}`
    : `当前简历:\n${resumeText}\n\n用户消息: ${message}`;

  messages.push({ role: "user", content: contextStr });

  // 如果有对话历史，附加上去
  if (history && history.length > 0) {
    messages.push(
      ...history.map((h) => ({
        role: h.role as "user" | "assistant",
        content: h.content,
      }))
    );
  }

  const res = await fetch(DEEPSEEK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages,
      temperature: 0.7,
      max_tokens: 4096,
    }),
  });

  const data: any = await res.json();
  const raw = data.choices?.[0]?.message?.content || "";

  try {
    const parsed = JSON.parse(raw);

    return {
      optimized: parsed.optimized || resumeText,
      changes: parsed.changes || [],
      reply: parsed.reply || "已根据您的要求完成修改",
      conversationId: `conv_${Date.now()}`,
    };
  } catch {
    return {
      optimized: raw || resumeText,
      changes: [],
      reply: "已根据您的要求完成修改",
      conversationId: `conv_${Date.now()}`,
    };
  }
}
