/**
 * ============================================
 * 图形验证码（Captcha）—— 自绘 SVG + 内存存储
 * ============================================
 *
 * 【职责】
 * 为「发送验证码」接口提供前置的图形验证码（防短信/邮件轰炸的最后一道
 * 人机校验）。生成 4 位字符 + 干扰线 + 噪点的 SVG 图片，答案存内存 Map。
 *
 * 【为什么自绘 SVG 而非引入 svg-captcha 依赖】
 * 1. 项目对依赖克制，4 位字符 + 干扰线 + 噪点足以挡住脚本，
 *    不必为这个引入第三方库；
 * 2. SVG 是纯文本，直接返回给前端渲染（img src=data:image/svg+xml 或
 *    dangerouslySetInnerHTML），无需写临时文件，天然无磁盘 IO。
 *
 * 【为什么答案存内存 Map 而非数据库】
 * 图形验证码是「一次性、短时效」的瞬态数据，价值低、生命周期短（2 分钟），
 * 落库纯属浪费；内存 Map 带惰性清理即可。重启丢失也完全可接受——
 * 用户刷新页面重新拿一张即可。
 *
 * 【安全要点】
 * - 一次性消费：校验成功立即 delete，同一 captchaId 不可复用；
 * - 2 分钟过期：过期即 delete，且校验时拒绝；
 * - 不分大小写：比对前统一转小写，减少用户输入成本；
 * - 常量时间比较：复用 verification-code 的 constantTimeEqual，防计时攻击。
 */

import { randomInt, randomBytes } from "crypto";
import { constantTimeEqual } from "./verification-code.js";

/** 验证码长度（4 位，兼顾易读与防脚本） */
const CAPTCHA_LENGTH = 4;

/** 过期时间（毫秒，2 分钟） */
const TTL_MS = 2 * 60 * 1000;

/** 字符集：去掉了 0/O/1/l/I 等易混淆字符，减少用户看错 */
const CHARSET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

/** 图形验证码答案（存内存） */
interface CaptchaRecord {
  /** 答案（小写，用于比对） */
  answer: string;
  /** 过期时间戳 */
  expiresAt: number;
}

/** 内存存储：captchaId → 答案记录 */
const store = new Map<string, CaptchaRecord>();

/**
 * 惰性清理：删除所有已过期的记录。
 *
 * 在每次生成/校验前调用，避免过期记录在内存里无限堆积。
 * 采用「生成时触发」而非定时器，简单可靠、无额外资源占用。
 */
function sweepExpired(): void {
  const now = Date.now();
  for (const [id, record] of store) {
    if (record.expiresAt <= now) store.delete(id);
  }
}

/**
 * 生成一张图形验证码。
 *
 * @returns { captchaId, svg } —— id 供后续校验，svg 为可渲染的 SVG 字符串
 */
export function generateCaptcha(): { captchaId: string; svg: string } {
  sweepExpired();

  // 生成 4 位随机字符
  let answer = "";
  for (let i = 0; i < CAPTCHA_LENGTH; i++) {
    answer += CHARSET[randomInt(CHARSET.length)];
  }

  // captchaId：32 字节随机数的十六进制（128 bit 熵，不可枚举）
  const captchaId = randomBytes(32).toString("hex");

  // 存入内存（答案转小写，比对时同样转小写，实现大小写不敏感）
  store.set(captchaId, {
    answer: answer.toLowerCase(),
    expiresAt: Date.now() + TTL_MS,
  });

  return { captchaId, svg: renderSvg(answer) };
}

/**
 * 校验图形验证码（一次性消费 + 常量时间比较）。
 *
 * @param captchaId - 生成时返回的 id
 * @param input     - 用户输入的答案
 * @returns 是否通过（通过后立即删除该记录）
 */
export function verifyCaptcha(captchaId: string, input: string): boolean {
  sweepExpired();

  const record = store.get(captchaId);
  if (!record) return false;

  // 无论是否匹配都立即删除：一次性消费，防重放
  store.delete(captchaId);

  if (record.expiresAt <= Date.now()) return false;

  return constantTimeEqual(record.answer, (input ?? "").trim().toLowerCase());
}

/**
 * 把 4 位字符渲染成带干扰线 + 噪点的 SVG。
 *
 * 【视觉设计】
 * - 每个字符随机微调位置、旋转角度、字体大小，增加 OCR 难度；
 * - 3 条随机贝塞尔干扰线 + 若干噪点，进一步干扰机器识别；
 * - 固定 viewBox 800x260，前端等比缩放。
 *
 * @param answer - 4 位明文答案
 * @returns SVG 字符串（含 XML 声明，可直接作为 img src 或内联渲染）
 */
function renderSvg(answer: string): string {
  const width = 800;
  const height = 260;
  const charWidth = width / CAPTCHA_LENGTH;

  // 每个字符的随机样式
  const chars = answer.split("").map((ch, i) => {
    const x = i * charWidth + charWidth / 2 + randomInt(-20, 20);
    const y = height / 2 + randomInt(-25, 25);
    const rotate = randomInt(-25, 25);
    const fontSize = randomInt(90, 120);
    const color = `hsl(${randomInt(0, 360)}, 60%, 40%)`;
    return `<text x="${x}" y="${y}" font-size="${fontSize}" font-family="monospace" font-weight="bold" fill="${color}" transform="rotate(${rotate} ${x} ${y})" text-anchor="middle" dominant-baseline="central">${ch}</text>`;
  }).join("");

  // 3 条随机贝塞尔干扰线
  let lines = "";
  for (let i = 0; i < 3; i++) {
    const y1 = randomInt(0, height);
    const y2 = randomInt(0, height);
    const c1 = randomInt(0, width / 2);
    const c2 = randomInt(width / 2, width);
    const stroke = `hsl(${randomInt(0, 360)}, 50%, 55%)`;
    lines += `<path d="M0 ${y1} C ${c1} ${y1}, ${c2} ${y2}, ${width} ${y2}" fill="none" stroke="${stroke}" stroke-width="${randomInt(1, 3)}" opacity="0.6"/>`;
  }

  // 20 个噪点
  let dots = "";
  for (let i = 0; i < 20; i++) {
    const cx = randomInt(0, width);
    const cy = randomInt(0, height);
    const r = randomInt(1, 3);
    dots += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="hsl(${randomInt(0, 360)}, 40%, 50%)" opacity="0.5"/>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#f5f7fb" rx="12"/><g>${chars}</g><g>${lines}</g><g>${dots}</g></svg>`;
}
