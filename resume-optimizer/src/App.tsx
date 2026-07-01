/**
 * App.tsx —— AI简历优化子应用根组件
 *
 * 【职责】
 * 作为子应用的根组件，负责：
 * 1. 提供全局 Ant Design 配置（ConfigProvider + App 组件包裹）
 * 2. 渲染简历优化主页面组件
 *
 * 【样式说明】
 * 子应用不引入 Tailwind CSS，所有样式通过 Ant Design 组件 + 内联/CSS Module 实现。
 * 这样可以避免与主应用的 Tailwind 样式冲突，保持子应用的独立性。
 */

import React from 'react';
import { ConfigProvider, App as AntdApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import ResumeOptimizationPage from './pages/ResumeOptimization';

/**
 * 子应用根组件
 *
 * - ConfigProvider：设置 Ant Design 全局配置（中文语言、主题等）
 * - AntdApp：Ant Design 5.x+ 的静态方法上下文提供者（message/notification/modal）
 */
const App: React.FC = () => {
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        // 使用与主应用一致的配色方案，确保视觉统一
        token: {
          colorPrimary: '#1677ff',
          borderRadius: 6,
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        },
      }}
    >
      <AntdApp>
        <ResumeOptimizationPage />
      </AntdApp>
    </ConfigProvider>
  );
};

export default App;
