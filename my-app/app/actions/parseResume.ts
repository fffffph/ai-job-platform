/**
 * parseResume.ts —— 简历文件解析 (Server Action)
 *
 * 【注意】
 * 此文件为 Next.js Server Action（'use server'），仅在主应用内部使用。
 * 微前端子应用无法直接调用 Server Action，需通过 /api/parse-resume API 路由访问。
 *
 * 【功能】
 * 解析上传的简历文件，提取纯文本内容。
 * 支持格式：TXT（直接读取）、DOCX（mammoth 解析）、PDF（pdf2json 解析）
 *
 * 【微前端 API 替代方案】
 * 子应用通过 fetch('/api/parse-resume', { method: 'POST', body: formData }) 调用，
 * 实现相同的文件解析功能。详见 app/api/parse-resume/route.ts
 *
 * 【调试日志】
 * key=cloudbase 路由用于可观测性上报（环境变量 LOG_RESUME_PARSE 控制）
 */

'use server';

import mammoth from 'mammoth';
import PDFParser from 'pdf2json';

function parsePDF(buffer: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const pdfParser = new PDFParser();
    
    pdfParser.on('pdfParser_dataReady', (pdfData: any) => {
      const texts: string[] = [];
      pdfData.Pages?.forEach((page: any) => {
        page.Texts?.forEach((text: any) => {
          text.R?.forEach((r: any) => {
            // ✅ 只有这里可能抛出 URIError，只给这里加
            try {
              texts.push(decodeURIComponent(r.T));
            } catch {
              texts.push(r.T || '');
            }
          });
        });
      });
      resolve(texts.join(' '));
    });
    
    pdfParser.on('pdfParser_dataError', reject);
    pdfParser.parseBuffer(buffer);
  });
}

export async function parseResume(formData: FormData): Promise<{ success: boolean; text?: string; error?: string }> {
  try {
    const file = formData.get('file') as File | null;
    if (!file) return { success: false, error: '未找到文件' };

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const fileName = file.name.toLowerCase();

    if (fileName.endsWith('.txt') || file.type === 'text/plain') {
      return { success: true, text: buffer.toString('utf-8') };
    }

    if (fileName.endsWith('.docx') || file.type.includes('wordprocessingml')) {
      const result = await mammoth.extractRawText({ buffer });
      return { success: true, text: result.value };
    }

    if (fileName.endsWith('.pdf') || file.type === 'application/pdf') {
      const text = await parsePDF(buffer);
      return { success: true, text: text.trim() };
    }

    return { success: false, error: '不支持的文件格式，目前仅支持 TXT, PDF, DOCX' };
  } catch (error: any) {
    console.error('File parsing error:', error);
    return { success: false, error: '文件解析失败: ' + error.message };
  }
}