/**
 * /api/parse-resume —— 简历文件解析 API
 *
 * 【背景】
 * 原项目中简历文件解析通过 Next.js Server Action（'use server'）实现。
 * 在微前端架构下，子应用无法直接调用主应用的 Server Action，
 * 因此需要将其暴露为标准的 REST API 端点。
 *
 * 【接口规范】
 * Method:  POST
 * Body:    FormData，字段名为 "file"
 *          支持的格式：PDF (.pdf)、DOCX (.docx)、TXT (.txt)
 * Response: JSON { success: boolean, text?: string, error?: string }
 *
 * 【子应用调用示例】
 * ```ts
 * const formData = new FormData();
 * formData.append('file', file);
 * const res = await fetch('/api/parse-resume', { method: 'POST', body: formData });
 * const data = await res.json();
 * ```
 */

import { NextResponse } from 'next/server';
import mammoth from 'mammoth';
import PDFParser from 'pdf2json';

/**
 * 解析 PDF 文件，提取所有页面的文本内容
 *
 * pdf2json 库将 PDF 解析为结构化 JSON 数据（PdfData），
 * 每个 Page 包含 Texts 数组，每个 Text 包含 R 数组（Run 文本片段），
 * 每个 R 中的 T 字段需要使用 decodeURIComponent 解码。
 *
 * @param buffer - PDF 文件的二进制 Buffer
 * @returns 解析后的纯文本内容
 */
function parsePDF(buffer: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const pdfParser = new PDFParser();

    // 监听解析成功事件
    pdfParser.on('pdfParser_dataReady', (pdfData: any) => {
      const texts: string[] = [];

      // 遍历所有页面，提取文本片段
      pdfData.Pages?.forEach((page: any) => {
        page.Texts?.forEach((text: any) => {
          text.R?.forEach((r: any) => {
            // decodeURIComponent 可能对某些特殊编码抛出 URIError
            try {
              texts.push(decodeURIComponent(r.T));
            } catch {
              texts.push(r.T || '');
            }
          });
        });
      });

      resolve(texts.join(' ')); // 用空格连接所有文本
    });

    // 监听解析失败事件
    pdfParser.on('pdfParser_dataError', reject);

    // 开始解析
    pdfParser.parseBuffer(buffer);
  });
}

/**
 * POST 请求处理函数
 *
 * 接收 FormData，提取文件并根据扩展名选择解析策略：
 * - .txt  → 直接读取为 UTF-8 文本
 * - .docx → mammoth.extractRawText() 提取纯文本
 * - .pdf  → pdf2json 逐页解析
 */
export async function POST(req: Request) {
  try {
    // ---------- 解析 FormData ----------
    // Next.js App Router 支持通过 req.formData() 获取表单数据
    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    // 校验：文件是否存在
    if (!file) {
      return NextResponse.json(
        { success: false, error: '未找到上传文件' },
        { status: 400 }
      );
    }

    // ---------- 提取文件信息 ----------
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const fileName = file.name.toLowerCase();

    // ---------- 根据文件类型解析 ----------

    // 纯文本文件
    if (fileName.endsWith('.txt') || file.type === 'text/plain') {
      return NextResponse.json({
        success: true,
        text: buffer.toString('utf-8'),
      });
    }

    // Word 文档
    if (fileName.endsWith('.docx') || file.type.includes('wordprocessingml')) {
      const result = await mammoth.extractRawText({ buffer });
      return NextResponse.json({
        success: true,
        text: result.value,
      });
    }

    // PDF 文件
    if (fileName.endsWith('.pdf') || file.type === 'application/pdf') {
      const text = await parsePDF(buffer);
      return NextResponse.json({
        success: true,
        text: text.trim(),
      });
    }

    // 不支持的格式
    return NextResponse.json(
      {
        success: false,
        error: '不支持的文件格式，目前仅支持 TXT、PDF、DOCX 三种格式',
      },
      { status: 400 }
    );
  } catch (error: any) {
    console.error('[api/parse-resume] 文件解析失败:', error);

    return NextResponse.json(
      {
        success: false,
        error: '文件解析失败: ' + (error.message || '未知错误'),
      },
      { status: 500 }
    );
  }
}
