/**
 * /api/chat —— AI 简历优化 API
 *
 * 【接口规范】
 * Method:  POST
 * Body:    JSON { resume: string }
 *           resume 字段为待优化的简历纯文本内容
 * Response: JSON { success: boolean, result?: string, message?: string }
 *
 * 【调用方】
 * - 原主应用简历页面（/dashboard/resume，已废弃的 Server Action 版本）
 * - 微前端子应用（resume-optimizer，当前活跃使用）
 *
 * 【AI 模型】
 * 使用 DeepSeek Chat 模型进行简历优化，通过 system prompt 设定 AI 角色为
 * "专业的 AI 简历优化专家"，要求 AI 从优化表达、增加专业度、提高面试通过率
 * 等维度对简历进行分析和改写。
 *
 * 【API Key 配置】
 * 通过环境变量 DEEPSEEK_API_KEY 配置，存储在 .env.local 中。
 * 生产环境建议使用更安全的方式管理（如 Vercel Environment Variables）。
 */

import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    // ---------- 解析请求体 ----------
    const body = await req.json();

    // ---------- 调用 DeepSeek API ----------
    // 使用 DeepSeek Chat 模型（deepseek-chat），通过 OpenAI 兼容接口调用
    const response = await fetch(
      "https://api.deepseek.com/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // 从环境变量中获取 API Key，确保密钥不暴露在代码中
          Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify({
          model: "deepseek-chat", // DeepSeek 对话模型
          messages: [
            {
              role: "system",
              // 【核心 prompt】设定 AI 的角色和行为准则
              // 这是 prompt engineering 的关键部分，决定了 AI 输出的质量和风格
              content: "你是一名专业的 AI 简历优化专家",
            },
            {
              role: "user",
              // 【用户 prompt】包含优化要求和简历原文
              content: `
请帮我优化下面这份简历。

重点：
1. 优化表达
2. 增加专业度
3. 提高面试通过率
4. 输出结构清晰

简历内容：

${body.resume}
              `,
            },
          ],
        }),
      }
    );

    const data = await response.json();

    // ---------- 错误处理 ----------
    // DeepSeek API 可能在请求频率超限、余额不足等情况下返回 error
    if (data.error) {
      return NextResponse.json({
        success: false,
        message: data.error.message || "DeepSeek API 返回错误",
      });
    }

    // ---------- 返回优化结果 ----------
    // data.choices[0].message.content 是 AI 生成的优化后简历文本
    return NextResponse.json({
      success: true,
      result: data.choices?.[0]?.message?.content || "无返回结果",
    });
  } catch (error: any) {
    console.log("[api/chat] 请求失败:", error);

    return NextResponse.json({
      success: false,
      message: error.message || "AI 请求失败",
    });
  }
}