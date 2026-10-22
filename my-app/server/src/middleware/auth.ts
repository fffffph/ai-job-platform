/**
 * ============================================
 * JWT 认证中间件
 * ============================================
 *
 * 【职责】
 * 验证请求中的 JWT Token，提取用户信息挂载到 req.user 上。
 * 所有需要登录才能访问的路由都应使用此中间件保护。
 *
 * 【使用方式】
 * import { authMiddleware } from "../middleware/auth.js";
 * router.get("/profile", authMiddleware, controller.getProfile);
 *
 * 【Token 格式】
 * 前端在 Authorization 头中携带：
 * Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
 *
 * 【工作流程】
 * 1. 从 Authorization 头提取 Bearer Token
 * 2. 使用 jwt.verify() 验证签名和过期时间
 * 3. 校验载荷完整性（必须有 sub），挂载 { id, email } 到 req.user 后 next()
 * 4. 校验失败 → 返回 401 { success: false, message, code }
 *
 * 【配套】
 * - req.user 的类型由 src/types/express.d.ts 通过声明合并补上，
 *   本文件因此不需要 (req as any) 断言；
 * - 业务侧取用户 ID 一律用本文件导出的 requireUser(req, res)，
 *   不要各自重复写 401 判断。
 */

import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { findActiveAccountById } from "../lib/user-query.js";

/**
 * JWT 签名密钥（与服务层 auth.service.ts 中一致）
 */
const JWT_SECRET = process.env.JWT_SECRET || "fallback-secret";

/**
 * 认证用户信息
 *
 * 类型增强声明见 src/types/express.d.ts：
 * req.user 的类型就是 AuthUser | undefined。
 */
export interface AuthUser {
  id: string;
  email: string;
  /**
   * 是否处于「必须修改密码」状态（管理员开启「首次登录强制修改密码」后为 true）。
   *
   * 【为什么要挂到 req.user 上】
   * 下游若需要给出更精准的提示（例如前端页面标题），可以直接读取；
   * 但「拦截」这件事已经在本中间件里做完了，下游不需要再判一次。
   */
  mustChangePassword: boolean;
}

// ============================================================
// 强制改密闸门（A-P0 补完）
// ============================================================

/**
 * 强制改密期间仍然放行的接口白名单。
 *
 * 【为什么用「默认拒绝 + 白名单」而不是「默认放行 + 黑名单」】
 * 黑名单只要将来新增一个接口忘了登记，就会立刻变成绕过强制改密的通道，
 * 而且这种漏洞不会有任何报错，极难发现。白名单则是「新增接口默认被拦」，
 * 最坏情况只是新接口在强制改密期不可用（可见、可修），不会静默失守。
 *
 * 【口径说明】
 * - 改密接口必须放行，否则用户永远改不了密码，账号直接被锁死；
 * - 读自己资料的接口放行，因为强制改密页要显示「你当前是用哪个账号登录的」。
 *   该接口只返回自己的公开信息（不含密码等敏感字段），放行无越权风险。
 */
const PASSWORD_GATE_WHITELIST: ReadonlyArray<{
  method: string;
  path: string;
}> = [
  { method: "PUT", path: "/api/user/password" },
  { method: "GET", path: "/api/user/profile" },
];

/**
 * 判断当前请求是否命中强制改密白名单。
 *
 * 【为什么用 originalUrl 而不是 req.path】
 * 路由是以 `app.use("/api/user", userRouter)` 形式多级挂载的，
 * 在路由级中间件里 `req.path` 已被重写为挂载点之后的相对路径（如 `/password`），
 * 而 `req.originalUrl` 始终是完整原始路径，不受挂载层级影响，判断最稳。
 *
 * 同时去掉查询串与结尾斜杠，避免 `/api/user/profile?x=1` 或
 * `/api/user/profile/` 这类写法绕过白名单。
 */
function isPasswordGateExempt(req: Request): boolean {
  const path = (req.originalUrl || req.url || "")
    .split("?")[0]
    .replace(/\/+$/, "");
  const method = req.method.toUpperCase();

  return PASSWORD_GATE_WHITELIST.some(
    (rule) => rule.method === method && rule.path === path
  );
}

/**
 * 认证中间件
 *
 * 必须在所有需要保护的 Controller 之前使用。
 * 中间件负责"验票"（确认 Token 有效），并在 payload 有效后追加
 * 四项账号实时校验：
 * - 账号是否存在且未软删除（软删除后旧 Token 立即失效）
 * - 账号是否被停用（P1-4 停用踢下线）
 * - Token 版本是否仍然有效（tokenVersion，支持改密码/重置后主动吊销旧 Token）
 * - 是否处于「必须修改密码」状态（A-P0 补完：强制改密闸门）
 *
 * 【为什么在鉴权链路校验这些？】
 * 停用、软删除、改密码若只在登录时拦截，其已签发的 Token 在过期前仍然可用，
 * 这是实实在在的安全漏洞。依据 P1-4 与 A-P0 设计，这里对每个请求实时校验，
 * 状态一变立即失效，无需等 Token 过期。
 *
 * 【为什么强制改密闸门也在这里】
 * 同理：前端路由跳转是可以被绕过（手敲 URL / 直接打接口）的，
 * 只有挂在所有受保护路由的必经隘口上，才是真正的「强制」。
 *
 * 【性能说明】
 * 这些校验复用同一次查库（一条 select 多取两列），
 * 不增加查询次数、不增加数据库压力。
 */
export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  // ---------- 步骤 1：提取 Token ----------
  const authHeader = req.headers.authorization;

  // 检查 Authorization 头是否存在
  if (!authHeader) {
    res.status(401).json({
      success: false,
      message: "未登录，请先登录",
      code: "UNAUTHORIZED",
    });
    return;
  }

  // 提取 Bearer Token（按空格分割，取第二部分）
  // 格式：Bearer eyJhbGciOi...
  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    res.status(401).json({
      success: false,
      message: "Token 格式错误",
      code: "UNAUTHORIZED",
    });
    return;
  }

  const token = parts[1];

  // ---------- 步骤 2：验证 Token ----------
  try {
    /**
     * jwt.verify(token, secret) 返回解码后的 payload
     * 如果 Token 过期或签名不匹配，会抛出 JsonWebTokenError / TokenExpiredError
     */
    const decoded = jwt.verify(token, JWT_SECRET) as {
      sub?: string; // 用户 ID（auth.service.ts 中定义的 subject）
      email?: string;
      tv?: number; // Token 版本号（A-P0 新增，用于主动吊销）
    };

    // ---------- 步骤 3：校验载荷完整性 ----------
    /**
     * 签名有效 ≠ 载荷可用。
     * 若 Token 缺少 sub，就无法定位用户，必须在这里直接拒绝；
     * 否则下游会拿到空 userId 继续执行业务逻辑（越权读写他人数据）。
     */
    if (typeof decoded.sub !== "string" || !decoded.sub) {
      res.status(401).json({
        success: false,
        message: "Token 无效，请重新登录",
        code: "UNAUTHORIZED",
      });
      return;
    }

    // ---------- 步骤 4：账号实时校验（停用 / 软删除 / Token 吊销） ----------
    // 统一走 user-query 封装：内部已带 deletedAt: null，
    // 软删除账号查不到 → 直接 401，杜绝「删了还能用」。
    const account = await findActiveAccountById(decoded.sub);

    if (!account) {
      res.status(401).json({
        success: false,
        message: "Token 无效，请重新登录",
        code: "UNAUTHORIZED",
      });
      return;
    }

    if (account.status === "disabled") {
      res.status(401).json({
        success: false,
        message: "账号已被停用，请联系管理员",
        code: "USER_DISABLED",
      });
      return;
    }

    /**
     * Token 版本比对（A-P0 新增）。
     *
     * 改密码 / 管理员重置密码 / 强制下线时会把 User.tokenVersion 加一，
     * 于是所有旧 Token 里带的 tv 与数据库对不上，立即失效。
     *
     * 兼容性：A-P0 之前签发的旧 Token 没有 tv 字段（undefined），
     * 此时按 0 处理（tokenVersion 的默认值也是 0），保证存量登录态不被打断。
     */
    if ((decoded.tv ?? 0) !== account.tokenVersion) {
      res.status(401).json({
        success: false,
        message: "登录状态已失效，请重新登录",
        code: "TOKEN_REVOKED",
      });
      return;
    }

    // ---------- 步骤 5：强制改密闸门 ----------
    /**
     * 管理员新建用户时若开启「首次登录强制修改密码」，该账号登录后
     * 必须先改密码才能使用其它功能。
     *
     * 【为什么必须放在后端拦】
     * 只在登录后做前端路由跳转是**可绕过的**：用户在地址栏手敲
     * /dashboard/xxx，或直接用 curl 带 Token 打接口，就绕过去了。
     * 放在 authMiddleware 这一唯一隘口上，才能做到真正的强制。
     *
     * 【放行范围】见 PASSWORD_GATE_WHITELIST 注释。
     */
    if (account.mustChangePassword && !isPasswordGateExempt(req)) {
      res.status(403).json({
        success: false,
        message: "请先修改初始密码后再使用其它功能",
        code: "PASSWORD_CHANGE_REQUIRED",
      });
      return;
    }

    // ---------- 步骤 6：挂载用户信息 ----------
    // 将用户信息挂载到 req 上，后续 Controller 通过 req.user 访问
    req.user = {
      id: account.id,
      email: decoded.email ?? "",
      mustChangePassword: account.mustChangePassword,
    } satisfies AuthUser;

    // Token 有效且账号正常，放行到下一个中间件/路由处理器
    next();
  } catch (error: any) {
    // ---------- Token 校验失败 ----------
    // 区分过期和无效两种情况
    if (error.name === "TokenExpiredError") {
      res.status(401).json({
        success: false,
        message: "登录已过期，请重新登录",
        code: "TOKEN_EXPIRED",
      });
      return;
    }

    // 其他校验失败（签名不匹配等）
    res.status(401).json({
      success: false,
      message: "Token 无效，请重新登录",
      code: "UNAUTHORIZED",
    });
    return;
  }
}

/**
 * 读取当前用户 ID（不写响应）
 *
 * 仅做读取，未登录时返回 null。
 * 适合「拿不到用户也不算错误」的场景（如日志、可选的画像读取）。
 */
export function getUserId(req: Request): string | null {
  // 空字符串同样视为未登录，避免下游拿到 "" 去查库
  return req.user?.id || null;
}

/**
 * 保证「已登录」的统一守卫：取出用户 ID，未登录时直接写出 401 响应。
 *
 * 【使用方式】（必须是守卫式调用，才能拿到收窄后的 string）
 * ```ts
 * const userId = requireUser(req, res);
 * if (!userId) return;   // 未登录：401 已写出，直接结束
 * ```
 *
 * 【为什么 authMiddleware 之后还需要它】
 * 1. 类型收窄：req.user?.id 是 string | undefined，而下游服务要求 string；
 * 2. 防御兜底：万一某条路由漏挂 authMiddleware，或 Token 载荷缺 sub，
 *    这里能统一拦住，而不是带着空 userId 继续查库；
 * 3. 收敛重复：401 的响应体全项目只此一份，改文案只改这里。
 *
 * 【注意】
 * 它必须在写响应头之前调用。SSE 场景（如 ai.routes.ts）要在
 * createSSEWriter(res) 之前使用，否则 401 只能通过 error 事件下发。
 *
 * @returns 已登录返回 userId；未登录时已写出 401 并返回 null
 */
export function requireUser(req: Request, res: Response): string | null {
  const userId = getUserId(req);

  if (!userId) {
    res.status(401).json({
      success: false,
      message: "未登录，请先登录",
      code: "UNAUTHORIZED",
    });
    return null;
  }

  return userId;
}
