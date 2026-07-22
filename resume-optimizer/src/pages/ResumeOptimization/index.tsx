/**
 * ResumeOptimization/index.tsx —— AI简历优化页面（子应用版本）
 *
 * 【与原主应用版本的差异】
 * 1. Server Action `parseResume` → fetch API `/api/parse-resume`
 * 2. `message.useMessage()` → `App.useApp().message`（适配 AntdApp 包裹器）
 * 3. 移除了 Next.js 特定导入（@/app/actions/parseResume）
 * 4. 保留所有 UI 组件、交互动画、AI 优化流程
 * 5. 添加了加载指示器组件，替换了 Skeleton
 *
 * 【API 调用说明】
 * 子应用通过 fetch 调用主应用的两个 API：
 * - POST /api/parse-resume  → 解析上传的简历文件（PDF/DOCX/TXT）
 * - POST /api/chat            → 调用 DeepSeek AI 进行简历优化
 */

import React, { useState } from 'react';
import { App, Card, Button, Progress, Space, Divider, Upload, Input, Tabs, Tag, Spin } from 'antd';
import {
  InboxOutlined,
  RobotOutlined,
  CheckCircleOutlined,
  ThunderboltOutlined,
  FileTextOutlined,
  RocketOutlined
} from '@ant-design/icons';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../../contexts/AuthContext';

const { Dragger } = Upload;
const { TextArea } = Input;

/**
 * 简历优化页面组件
 *
 * 功能模块：
 * - 左侧面板：简历上传/文本输入 + AI优化触发按钮
 * - 右侧面板：AI 分析结果展示（评分、亮点、优化建议）
 *
 * 交互状态：
 * - initial: 空状态，提示用户上传简历
 * - optimizing: 加载中，显示动画和骨架屏
 * - result: 展示优化结果（评分卡片 + 建议列表）
 */
const ResumeOptimizationPage: React.FC = () => {
  // ========== Ant Design 静态方法 ==========
  // AntdApp 包裹器中的 useApp() 提供 message/modal/notification 实例
  const { message } = App.useApp();

  // ========== 认证（Token 注入）==========
  // 从 AuthContext 获取当前 Token，注入到后续 API 请求的 Authorization 头中
  const { token } = useAuth();

  // ========== 状态管理 ==========
  const [isOptimizing, setIsOptimizing] = useState(false);   // 是否正在优化
  const [hasResult, setHasResult] = useState(false);          // 是否有优化结果
  const [resumeText, setResumeText] = useState('');           // 文本输入的简历内容
  const [fileList, setFileList] = useState<any[]>([]);        // 上传的文件列表
  const [optimizationResult, setOptimizationResult] = useState(''); // AI 返回的优化结果

  /**
   * 触发 AI 简历优化
   *
   * 执行流程：
   * 1. 校验输入（至少上传文件或输入文本）
   * 2. 如有文件上传，先调用文件解析 API 提取文本
   * 3. 将文本发送给 AI 优化 API
   * 4. 展示优化结果
   */
  const handleOptimize = async () => {
    // ---------- 校验：必须有输入 ----------
    if (!resumeText && fileList.length === 0) {
      message.warning('请先上传简历或输入简历内容');
      return;
    }

    setIsOptimizing(true);
    setHasResult(false);
    setOptimizationResult('');

    try {
      let contentToOptimize = resumeText;

      // ---------- 文件解析：将上传的 PDF/DOCX/TXT 转为文本 ----------
      if (fileList.length > 0 && !resumeText) {
        const file = fileList[0].originFileObj;
        if (file) {
          const formData = new FormData();
          formData.append('file', file);

          // 调用主应用的简历解析 API（替代原来的 Server Action）
          const parseRes = await fetch('/api/parse-resume', {
            method: 'POST',
            headers: {
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: formData,
          });

          const parseResult = await parseRes.json();

          if (parseResult.success && parseResult.text) {
            contentToOptimize = parseResult.text;
          } else {
            message.error(parseResult.error || '文件解析失败，请检查文件格式');
            setIsOptimizing(false);
            return;
          }
        }
      }

      // ---------- 二次校验：确保有有效内容 ----------
      if (!contentToOptimize || contentToOptimize.trim() === '') {
        message.warning('无法获取有效的简历内容');
        setIsOptimizing(false);
        return;
      }

      // ---------- AI 优化请求 ----------
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ resume: contentToOptimize }),
      });

      const data = await res.json();

      if (data.success) {
        setOptimizationResult(data.result);
        setHasResult(true);
        message.success('AI 简历优化完成！');
      } else {
        message.error(data.message || 'AI 优化失败，请稍后重试');
      }
    } catch (error) {
      console.error('[resume-optimizer] 网络请求失败:', error);
      message.error('网络请求失败，请检查网络连接后重试');
    } finally {
      setIsOptimizing(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--background, #f5f5f5)', padding: '24px 48px' }}>
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        style={{ maxWidth: '1280px', margin: '0 auto' }}
      >
        {/* ===== 页面标题 ===== */}
        <div style={{ marginBottom: '32px' }}>
          <h1 style={{
            fontSize: '30px',
            fontWeight: 'bold',
            color: 'var(--foreground, #1a1a1a)',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            margin: 0,
          }}>
            <RocketOutlined style={{ color: '#8b5cf6', fontSize: '28px' }} />
            AI 简历优化
          </h1>
          <p style={{ color: 'var(--muted-foreground, #666)', marginTop: '8px', fontSize: '14px' }}>
            利用先进的 AI 大模型，深度解析您的简历，提供专业的优化建议和排版修改。
          </p>
        </div>

        {/* ===== 两栏布局 ===== */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '32px' }}
             className="lg-grid-cols-12"
        >
          {/* ===== 左侧：简历输入区 ===== */}
          <Card
            className="lg-col-span-5"
            style={{
              background: 'var(--card, #fff)',
              border: '1px solid var(--border, #e5e7eb)',
              borderRadius: '12px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
            }}
          >
            <Tabs
              defaultActiveKey="upload"
              items={[
                {
                  key: 'upload',
                  label: '上传简历',
                  children: (
                    <div style={{ marginTop: '16px' }}>
                      {/* 
                        Dragger 拖拽上传组件：
                        - beforeUpload={false} 阻止自动上传，由 handleOptimize 统一处理
                        - multiple={false} 只允许上传单个文件
                        - accept 限制支持的文件格式
                      */}
                      <Dragger
                        name="file"
                        multiple={false}
                        fileList={fileList}
                        accept=".pdf,.docx,.txt"
                        beforeUpload={() => false}
                        onChange={(info) => setFileList(info.fileList)}
                        style={{ background: 'var(--card, #fafafa)', borderRadius: '8px' }}
                      >
                        <p className="ant-upload-drag-icon">
                          <InboxOutlined style={{ color: '#1677ff', fontSize: '48px' }} />
                        </p>
                        <p style={{ color: 'var(--foreground, #1a1a1a)', fontSize: '16px' }}>
                          点击或拖拽文件到此区域
                        </p>
                        <p style={{ color: 'var(--muted-foreground, #999)', fontSize: '14px' }}>
                          支持 PDF, DOCX, TXT 格式，文件大小不超过 10MB
                        </p>
                      </Dragger>
                    </div>
                  ),
                },
                {
                  key: 'text',
                  label: '文本输入',
                  children: (
                    <div style={{ marginTop: '16px' }}>
                      <TextArea
                        rows={12}
                        placeholder="在此粘贴您的简历文本内容..."
                        value={resumeText}
                        onChange={(e) => setResumeText(e.target.value)}
                        style={{
                          background: 'var(--background, #fff)',
                          color: 'var(--foreground, #1a1a1a)',
                          borderColor: 'var(--border, #d9d9d9)',
                        }}
                      />
                    </div>
                  ),
                },
              ]}
            />

            {/* ===== 操作按钮 ===== */}
            <div style={{ marginTop: '32px', paddingTop: '24px', borderTop: '1px solid var(--border, #e5e7eb)' }}>
              <Button
                type="primary"
                size="large"
                block
                icon={isOptimizing ? <RobotOutlined spin /> : <RocketOutlined />}
                onClick={handleOptimize}
                loading={isOptimizing}
                style={{
                  height: '48px',
                  fontSize: '16px',
                  background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
                  border: 'none',
                  boxShadow: '0 4px 12px rgba(139, 92, 246, 0.3)',
                }}
              >
                {isOptimizing ? 'AI 正在深度分析中...' : '开始 AI 优化'}
              </Button>
            </div>
          </Card>

          {/* ===== 右侧：AI 优化结果区 ===== */}
          <Card
            className="lg-col-span-7"
            style={{
              background: 'var(--card, #fff)',
              border: '1px solid var(--border, #e5e7eb)',
              borderRadius: '12px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
              minHeight: '600px',
            }}
          >
            {/* 标题 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '24px' }}>
              <RobotOutlined style={{ fontSize: '24px', color: '#8b5cf6' }} />
              <h2 style={{ fontSize: '20px', fontWeight: 600, margin: 0, color: 'var(--foreground, #1a1a1a)' }}>
                优化分析结果
              </h2>
            </div>
            <Divider style={{ margin: '16px 0', borderColor: 'var(--border, #e5e7eb)' }} />

            {/* 
              AnimatePresence：Framer Motion 提供的动画容器
              在子元素进入/离开 DOM 时自动触发过渡动画
            */}
            <AnimatePresence mode="wait">
              {/* ===== 状态1：空状态（初始） ===== */}
              {!isOptimizing && !hasResult && (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: '400px',
                    color: 'var(--muted-foreground, #999)',
                  }}
                >
                  <FileTextOutlined style={{ fontSize: '64px', marginBottom: '16px', opacity: 0.2 }} />
                  <p style={{ fontSize: '15px' }}>
                    上传或输入简历并点击「开始 AI 优化」，AI 将在此展示分析结果
                  </p>
                </motion.div>
              )}

              {/* ===== 状态2：加载中 ===== */}
              {isOptimizing && (
                <motion.div
                  key="loading"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  style={{ padding: '48px 0' }}
                >
                  {/* 脉冲动画指示器 */}
                  <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '48px' }}>
                    <div style={{
                      position: 'relative',
                      width: '96px',
                      height: '96px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}>
                      <div style={{
                        position: 'absolute',
                        inset: 0,
                        border: '4px solid rgba(139, 92, 246, 0.3)',
                        borderRadius: '50%',
                        animation: 'ping 1.5s ease-out infinite',
                      }} />
                      <div style={{
                        position: 'absolute',
                        inset: '8px',
                        border: '4px solid rgba(59, 130, 246, 0.5)',
                        borderRadius: '50%',
                        animation: 'spin 1s linear infinite',
                      }} />
                      <RobotOutlined
                        style={{ fontSize: '40px', color: '#8b5cf6', animation: 'pulse 2s ease-in-out infinite', zIndex: 1 }}
                      />
                    </div>
                  </div>

                  {/* 骨架屏占位 */}
                  <Spin description="AI 正在分析您的简历..." size="large">
                    <div style={{ padding: '48px', background: 'var(--background, #f5f5f5)', borderRadius: '8px' }} />
                  </Spin>
                </motion.div>
              )}

              {/* ===== 状态3：优化结果 ===== */}
              {hasResult && !isOptimizing && (
                <motion.div
                  key="result"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4 }}
                >
                  {/* ---- 评分卡片 ---- */}
                  <div style={{
                    background: 'rgba(59, 130, 246, 0.05)',
                    borderRadius: '12px',
                    padding: '24px',
                    display: 'flex',
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: '32px',
                    border: '1px solid rgba(59, 130, 246, 0.1)',
                    marginBottom: '24px',
                  }}>
                    {/* 评分进度环 */}
                    <Progress
                      type="circle"
                      percent={85}
                      strokeColor={{ '0%': '#3b82f6', '100%': '#8b5cf6' }}
                      format={(percent) => (
                        <span style={{ fontWeight: 'bold', fontSize: '30px', color: 'var(--foreground, #1a1a1a)' }}>
                          {percent}
                        </span>
                      )}
                      size={120}
                    />
                    <div style={{ flex: 1 }}>
                      <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '8px', color: 'var(--foreground, #1a1a1a)' }}>
                        简历综合得分
                      </h3>
                      <p style={{ color: 'var(--muted-foreground, #666)', fontSize: '14px', marginBottom: '16px', lineHeight: 1.6 }}>
                        您的简历整体表现不错，击败了 85% 的候选人。但仍有一些细节可以提升，以增加面试邀约率。
                      </p>
                      <Space size={8}>
                        <Tag color="success" style={{ borderColor: 'rgba(34, 197, 94, 0.3)', background: 'rgba(34, 197, 94, 0.1)', color: '#16a34a' }}>
                          格式规范
                        </Tag>
                        <Tag color="success" style={{ borderColor: 'rgba(34, 197, 94, 0.3)', background: 'rgba(34, 197, 94, 0.1)', color: '#16a34a' }}>
                          经验丰富
                        </Tag>
                        <Tag color="warning" style={{ borderColor: 'rgba(234, 179, 8, 0.3)', background: 'rgba(234, 179, 8, 0.1)', color: '#ca8a04' }}>
                          缺少数据支撑
                        </Tag>
                      </Space>
                    </div>
                  </div>

                  {/* ---- 详细建议 ---- */}
                  <div>
                    {/* 亮点与优势 */}
                    <div style={{ marginBottom: '24px' }}>
                      <h4 style={{
                        fontSize: '15px',
                        fontWeight: 500,
                        color: 'var(--foreground, #1a1a1a)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        marginBottom: '12px',
                      }}>
                        <CheckCircleOutlined style={{ color: '#22c55e' }} />
                        亮点与优势
                      </h4>
                      <ul style={{
                        listStyle: 'disc',
                        paddingLeft: '28px',
                        color: 'var(--muted-foreground, #666)',
                        fontSize: '14px',
                        lineHeight: 2,
                      }}>
                        <li>技术栈描述清晰，涵盖了前端主流框架（React, Vue）。</li>
                        <li>项目经验与所申请的"高级前端工程师"岗位匹配度高。</li>
                        <li>教育背景及基础信息完整无误。</li>
                      </ul>
                    </div>

                    <Divider style={{ borderColor: 'var(--border, #e5e7eb)' }} />

                    {/* AI 优化建议 */}
                    <div>
                      <h4 style={{
                        fontSize: '15px',
                        fontWeight: 500,
                        color: 'var(--foreground, #1a1a1a)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        marginBottom: '12px',
                      }}>
                        <ThunderboltOutlined style={{ color: '#eab308' }} />
                        优化建议（AI 诊断）
                      </h4>
                      <div style={{
                        background: 'var(--card, #fafafa)',
                        border: '1px solid var(--border, #e5e7eb)',
                        borderRadius: '8px',
                        padding: '16px',
                        whiteSpace: 'pre-wrap',
                        fontSize: '14px',
                        color: 'var(--muted-foreground, #666)',
                        lineHeight: 1.8,
                        minHeight: '120px',
                      }}>
                        {optimizationResult || 'AI 暂无具体建议'}
                      </div>
                    </div>
                  </div>

                  {/* ---- 操作按钮 ---- */}
                  <div style={{
                    display: 'flex',
                    justifyContent: 'flex-end',
                    gap: '16px',
                    paddingTop: '24px',
                    marginTop: '24px',
                    borderTop: '1px solid var(--border, #e5e7eb)',
                  }}>
                    <Button size="large">导出 PDF</Button>
                    <Button
                      type="primary"
                      size="large"
                      icon={<RocketOutlined />}
                      style={{
                        background: '#8b5cf6',
                        borderColor: '#8b5cf6',
                      }}
                    >
                      一键应用全部建议
                    </Button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </Card>
        </div>
      </motion.div>

      {/* ===== 内联关键帧动画（用于加载指示器） ===== */}
      <style>{`
        @keyframes ping {
          0% { transform: scale(1); opacity: 1; }
          100% { transform: scale(1.5); opacity: 0; }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }

        /* 响应式：大屏幕下采用双栏布局 */
        @media (min-width: 1024px) {
          .lg-grid-cols-12 {
            grid-template-columns: repeat(12, 1fr) !important;
          }
          .lg-col-span-5 {
            grid-column: span 5 !important;
          }
          .lg-col-span-7 {
            grid-column: span 7 !important;
          }
        }
      `}</style>
    </div>
  );
};

export default ResumeOptimizationPage;
