/**
 * ============================================
 * 全局错误处理中间件
 * ============================================
 *
 * 【功能】
 * 捕获 Express 路由中抛出的所有异常，统一返回 JSON 格式的错误响应。
 * 支持两种场景：
 * 1. 同步/异步路由处理器中 throw 的错误
 * 2. 调用 next(error) 传递的错误
 *
 * 【注册位置】
 * 必须在所有路由之后注册，Express 中间件的执行顺序决定了
 * 只有在前面中间件中 next(error) 才会进入此处理器。
 *
 * 【环境适配】
 * 开发环境：返回详细的错误堆栈信息，方便调试
 * 生产环境：仅返回用户友好的提示，隐藏内部实现细节
 */

import type { Request, Response, NextFunction } from "express";

/**
 * Express 错误处理中间件（必须有 4 个参数）
 *
 * Express 通过参数数量来区分普通中间件（3 个参数）和错误处理中间件（4 个参数）。
 * 第一个参数 err 是前一个中间件调用 next(error) 时传入的错误对象。
 *
 * @param err    - 错误对象（可以是 Error 实例或任意值）
 * @param _req   - 请求对象（前缀 _ 表示未使用但必须保留）
 * @param res    - 响应对象
 * @param _next  - 下一个中间件函数（一般不再调用）
 */
export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  // ---------- 日志记录 ----------
  // 服务端打印完整错误信息，用于排查问题
  console.error("[错误处理中间件]", {
    message: err.message,
    stack: err.stack,
    timestamp: new Date().toISOString(),
  });

  // ---------- 环境判断 ----------
  // 开发环境返回详细错误信息，生产环境隐藏内部细节
  const isDev = process.env.NODE_ENV === "development";

  // ---------- 响应格式 ----------
  // 所有错误统一返回 JSON 格式，方便前端统一处理
  res.status(500).json({
    success: false,
    message: "服务器内部错误，请稍后重试",
    // 开发环境附加错误详情，生产环境不暴露
    error: isDev ? err.message : undefined,
    // 错误堆栈仅在开发环境返回
    stack: isDev ? err.stack : undefined,
  });
}
