"use client";

/**
 * ============================================
 * 系统设置目录布局（/dashboard/system/*）
 * ============================================
 *
 * 【职责】
 * 作为「系统设置」目录下所有子页面的统一权限守卫（P1-3）：
 * 加载当前用户菜单/权限后，若无 `system` 权限则渲染 403 提示页（不跳转、不白屏），
 * 有权限则正常渲染子页面。
 *
 * 【为什么用「渲染提示」而非「重定向」？】
 * 依据主理人拍板 A5：保留上下文、避免跳转带来的困惑，符合 PRD §4.5「不跳转、不白屏」。
 *
 * 【权限判断】
 * hasPermission(PERMISSIONS.SYSTEM)：admin 恒 true；
 * 普通用户读 window 单例的 permissions / menus（含目录级 code）。
 */

import React, { useEffect, useState } from "react";
import { Alert, Button } from "antd";
import { LockOutlined } from "@ant-design/icons";
import { useRouter } from "next/navigation";
import { loadAppConfig, hasPermission } from "@/lib/app-config";
import { PERMISSIONS } from "@/lib/permissions";

export default function SystemLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  // 是否已完成权限加载（避免首帧误判）
  const [ready, setReady] = useState(false);
  // 是否具备系统设置权限
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadAppConfig()
      .then(() => {
        if (cancelled) return;
        setAllowed(hasPermission(PERMISSIONS.SYSTEM));
        setReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        setAllowed(false);
        setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 权限未就绪：不渲染内容（避免闪烁与误判）
  if (!ready) return null;

  // 无权限：渲染 403 提示页（不跳转、不白屏）
  if (!allowed) {
    return (
      <div style={{ padding: "64px 32px", maxWidth: 720, margin: "0 auto" }}>
        <Alert
          type="error"
          showIcon
          icon={<LockOutlined />}
          message="403 · 无访问权限"
          description="你没有访问「系统设置」的权限，请联系管理员为你分配相应角色。"
          action={
            <Button type="primary" onClick={() => router.replace("/dashboard")}>
              返回工作台
            </Button>
          }
        />
      </div>
    );
  }

  return <>{children}</>;
}
