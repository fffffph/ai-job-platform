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