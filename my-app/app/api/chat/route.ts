import { NextResponse } from "next/server";

export async function POST(req: Request) {

  try {

    const body = await req.json();

    const response = await fetch(
      "https://api.deepseek.com/chat/completions",
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",

          Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        },

        body: JSON.stringify({

          model: "deepseek-chat",

          messages: [
            {
              role: "system",
              content: "你是一名专业的 AI 简历优化专家",
            },

            {
              role: "user",
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

    if (data.error) {
      return NextResponse.json({
        success: false,
        message: data.error.message || "DeepSeek API 返回错误",
      });
    }

    return NextResponse.json({
      success: true,

      result: data.choices?.[0]?.message?.content || "无返回结果",
    });

  } catch (error: any) {

    console.log(error);

    return NextResponse.json({
      success: false,
      message: error.message || "AI 请求失败",
    });
  }
}