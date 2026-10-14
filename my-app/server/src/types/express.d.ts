/**
 * ============================================
 * Express 类型增强（Express Type Augmentation）
 * ============================================
 *
 * 【解决什么问题】
 * authMiddleware 会把 JWT 里的用户信息挂载到 req.user 上，
 * 但 Express 的 Request 类型原生没有 user 字段，于是业务代码里
 * 到处出现 `(req as any).user?.id` / `(req as { user?: ... }).user?.id`
 * 这类强制断言：
 * - 断言会绕过类型检查，把「用户 ID 为空」的隐患静默带进业务层；
 * - 全项目写法不统一（controllers 用 as any、routes 用 as {...}），难维护。
 *
 * 【怎么解决】
 * 用声明合并（Declaration Merging）给 Express.Request 补上 user 字段。
 * 此后全项目直接写 req.user?.id / req.user?.email，既有类型提示，
 * 也能被 TS 正确收窄，不再需要任何断言。
 *
 * 【谁负责挂载】
 * 只有 middleware/auth.ts 里的 authMiddleware 会写这个字段，
 * 其余代码一律只读，不要直接赋值。
 */

import type { AuthUser } from "../middleware/auth.js";

declare global {
  namespace Express {
    interface Request {
      /** 当前登录用户（由 authMiddleware 挂载；未登录时该字段为 undefined） */
      user?: AuthUser;
    }
  }
}
