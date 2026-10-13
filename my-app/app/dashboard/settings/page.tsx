"use client";

/**
 * 旧路径兼容（决策 D7）
 *
 * 原「系统设置」页面已平移为 /dashboard/system/config，
 * 本页面保留并重定向到新路径，避免书签失效。
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function SettingsRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    // replace 替换历史记录，避免用户回退时又落到旧路径
    router.replace("/dashboard/system/config");
  }, [router]);

  // 重定向期间不渲染内容
  return null;
}
