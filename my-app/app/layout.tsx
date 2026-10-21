import type { Metadata } from 'next'
import { Analytics } from '@vercel/analytics/next'
import { ThemeProvider } from '@/components/theme-provider'
import { AntdRegistry } from '@ant-design/nextjs-registry'
import './globals.css'

// 注：脚手架遗留的 Geist 字体导入已移除 —— 实际排版走 Tailwind 的
// font-sans（globals.css），声明了却不用反而造成「未使用变量」噪音。

export const metadata: Metadata = {
  title: 'CareerAI - 智能求职助手',
  description: '利用 AI 技术，智能匹配工作、优化简历、模拟面试，助你轻松拿下理想 Offer',
  generator: 'v0.app',
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      {/*
        suppressHydrationWarning（body）：防御浏览器扩展对 body 属性的注入。
        「自定义光标」类扩展（如 Custom Cursor）会在 React 水合前往 <body> 上
        写入 style={cursor:url(...)} 和 data-cc-prev-cursor 等属性，导致 SSR
        HTML 与客户端不一致、触发 hydration 告警。该属性只抑制「本元素的
        属性差异」一层，不影响子组件的水合检查——是 React 官方认可的处置方式。
        <html> 上的同名属性是给 next-themes 切换 class 用的，用途不同。
      */}
      <body
        suppressHydrationWarning
        className="font-sans antialiased bg-background text-foreground transition-colors duration-300"
      >
        <AntdRegistry>
          <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
            {children}
            {process.env.NODE_ENV === 'production' && <Analytics />}
          </ThemeProvider>
        </AntdRegistry>
      </body>
    </html>
  )
}
