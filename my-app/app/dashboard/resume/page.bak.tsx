/**
 * ============================================================
 * 此文件是原 AI简历优化页面的备份
 * 原始代码已迁移到 resume-optimizer 子应用项目中
 * 当前 /dashboard/resume 路由加载的是微前端子应用版本
 *
 * 如需回退到纯 Next.js 版本：
 * 1. 将本文件内容覆盖 page.tsx
 * 2. 删除 MicroAppLoader 导入
 * ============================================================
 */

"use client";

import React, { useState } from 'react';
import { Card, Button, Progress, Space, Divider, Upload, Input, Tabs, Tag, message, Skeleton } from 'antd';
import { 
  InboxOutlined, 
  RobotOutlined, 
  CheckCircleOutlined, 
  ThunderboltOutlined,
  FileTextOutlined,
  RocketOutlined
} from '@ant-design/icons';
import { motion, AnimatePresence } from 'framer-motion';
import { parseResume } from '@/app/actions/parseResume';

const { Dragger } = Upload;
const { TextArea } = Input;

export default function ResumeOptimizationPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [hasResult, setHasResult] = useState(false);
  const [resumeText, setResumeText] = useState("");
  const [fileList, setFileList] = useState<any[]>([]);
  const [optimizationResult, setOptimizationResult] = useState<string>("");

  const handleOptimize = async () => {
    if (!resumeText && fileList.length === 0) {
      messageApi.warning("请先上传简历或输入简历内容");
      return;
    }

    setIsOptimizing(true);
    setHasResult(false);
    setOptimizationResult("");

    try {
      let contentToOptimize = resumeText;

      if (fileList.length > 0 && !resumeText) {
        const file = fileList[0].originFileObj;
        if (file) {
          const formData = new FormData();
          formData.append('file', file);
          const parseResult = await parseResume(formData);
          
          if (parseResult.success && parseResult.text) {
            contentToOptimize = parseResult.text;
          } else {
            messageApi.error(parseResult.error || "文件解析失败");
            setIsOptimizing(false);
            return;
          }
        }
      }

      if (!contentToOptimize || contentToOptimize.trim() === "") {
        messageApi.warning("无法获取有效的简历内容");
        setIsOptimizing(false);
        return;
      }

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ resume: contentToOptimize }),
      });

      const data = await res.json();

      if (data.success) {
        setOptimizationResult(data.result);
        setHasResult(true);
        messageApi.success("AI 简历优化完成！");
      } else {
        messageApi.error(data.message || "AI 优化失败");
      }
    } catch (error) {
      console.error(error);
      messageApi.error("网络请求失败，请稍后再试");
    } finally {
      setIsOptimizing(false);
    }
  };

  return (
    <div className="min-h-screen bg-background p-6 md:p-12">
      {contextHolder}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-7xl mx-auto"
      >
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground flex items-center gap-3">
            <RocketOutlined className="text-purple-500" />
            AI 简历优化
          </h1>
          <p className="text-muted-foreground mt-2">
            利用先进的 AI 大模型，深度解析您的简历，提供专业的优化建议和排版修改。
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* 左侧：简历输入区 */}
          <div className="lg:col-span-5 flex flex-col gap-6">
            <Card className="bg-card/50 shadow-sm border-border h-full flex flex-col">
              <Tabs 
                defaultActiveKey="upload" 
                items={[
                  {
                    key: 'upload',
                    label: '上传简历',
                    children: (
                      <div className="mt-4">
                        <Dragger
                          name="file"
                          multiple={false}
                          fileList={fileList}
                          beforeUpload={() => false}
                          onChange={(info) => setFileList(info.fileList)}
                          className="bg-card/50 hover:border-primary transition-colors"
                        >
                          <p className="ant-upload-drag-icon">
                            <InboxOutlined className="text-primary" />
                          </p>
                          <p className="ant-upload-text text-foreground">点击或拖拽文件到此区域</p>
                          <p className="ant-upload-hint text-muted-foreground">
                            支持 PDF, DOCX, TXT 格式，文件大小不超过 10MB
                          </p>
                        </Dragger>
                      </div>
                    )
                  },
                  {
                    key: 'text',
                    label: '文本输入',
                    children: (
                      <div className="mt-4">
                        <TextArea
                          rows={12}
                          placeholder="在此粘贴您的简历文本内容..."
                          className="bg-background text-foreground border-border"
                          value={resumeText}
                          onChange={(e) => setResumeText(e.target.value)}
                        />
                      </div>
                    )
                  }
                ]}
              />

              <div className="mt-8 pt-6 border-t border-border">
                <Button 
                  type="primary" 
                  size="large" 
                  block 
                  icon={isOptimizing ? <RobotOutlined spin /> : <RocketOutlined />}
                  onClick={handleOptimize}
                  loading={isOptimizing}
                  className="bg-gradient-to-r from-blue-600 to-purple-600 border-0 hover:from-blue-500 hover:to-purple-500 h-12 text-lg shadow-md flex items-center justify-center"
                >
                  {isOptimizing ? "AI 正在深度分析中..." : "开始 AI 优化"}
                </Button>
              </div>
            </Card>
          </div>

          {/* 右侧：AI 优化结果区 */}
          <div className="lg:col-span-7">
            <Card className="bg-card/50 shadow-sm border-border h-full min-h-[600px]">
              <div className="flex items-center gap-2 mb-6">
                <RobotOutlined className="text-2xl text-purple-500" />
                <h2 className="text-xl font-semibold m-0 text-foreground">优化分析结果</h2>
              </div>
              <Divider className="my-4 border-border" />

              <AnimatePresence mode="wait">
                {!isOptimizing && !hasResult && (
                  <motion.div 
                    key="empty"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex flex-col items-center justify-center h-[400px] text-muted-foreground"
                  >
                    <FileTextOutlined className="text-6xl mb-4 opacity-20" />
                    <p>上传或输入简历并点击「开始 AI 优化」，AI 将在此展示分析结果</p>
                  </motion.div>
                )}

                {isOptimizing && (
                  <motion.div 
                    key="loading"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="space-y-8 py-12"
                  >
                    <div className="flex items-center justify-center mb-12">
                      <div className="relative flex items-center justify-center w-24 h-24">
                        <div className="absolute inset-0 border-4 border-purple-500/30 rounded-full animate-ping"></div>
                        <div className="absolute inset-2 border-4 border-blue-500/50 rounded-full animate-spin"></div>
                        <RobotOutlined className="text-4xl text-purple-600 animate-pulse" />
                      </div>
                    </div>
                    <Skeleton active paragraph={{ rows: 2 }} />
                    <Skeleton active paragraph={{ rows: 3 }} />
                    <Skeleton active paragraph={{ rows: 4 }} />
                  </motion.div>
                )}

                {hasResult && !isOptimizing && (
                  <motion.div 
                    key="result"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-8"
                  >
                    <div className="bg-primary/5 rounded-xl p-6 flex flex-col sm:flex-row items-center gap-8 border border-primary/10">
                      <Progress 
                        type="circle" 
                        percent={85} 
                        strokeColor={{ '0%': '#3b82f6', '100%': '#8b5cf6' }}
                        format={percent => <span className="text-foreground font-bold text-3xl">{percent}</span>}
                        size={120}
                      />
                      <div className="flex-1">
                        <h3 className="text-lg font-semibold mb-2 text-foreground">简历综合得分</h3>
                        <p className="text-muted-foreground text-sm mb-4">
                          您的简历整体表现不错，击败了 85% 的候选人。但仍有一些细节可以提升，以增加面试邀约率。
                        </p>
                        <Space>
                          <Tag color="success">格式规范</Tag>
                          <Tag color="success">经验丰富</Tag>
                          <Tag color="warning">缺少数据支撑</Tag>
                        </Space>
                      </div>
                    </div>

                    <div className="space-y-6">
                      <div>
                        <h4 className="text-foreground font-medium flex items-center gap-2 mb-3">
                          <CheckCircleOutlined className="text-green-500" />
                          亮点与优势
                        </h4>
                        <ul className="list-disc list-inside text-muted-foreground space-y-2 text-sm ml-2">
                          <li>技术栈描述清晰，涵盖了前端主流框架（React, Vue）。</li>
                          <li>项目经验与所申请的"高级前端工程师"岗位匹配度高。</li>
                          <li>教育背景及基础信息完整无误。</li>
                        </ul>
                      </div>

                      <Divider className="border-border" />

                      <div>
                        <h4 className="text-foreground font-medium flex items-center gap-2 mb-3">
                          <ThunderboltOutlined className="text-yellow-500" />
                          优化建议 (AI 诊断)
                        </h4>
                        <div className="space-y-4">
                          <div className="bg-card border border-border p-4 rounded-lg whitespace-pre-wrap text-sm text-muted-foreground">
                            {optimizationResult || "AI 暂无具体建议"}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="pt-4 flex justify-end gap-4">
                      <Button size="large">导出 PDF</Button>
                      <Button type="primary" size="large" className="bg-purple-600 hover:bg-purple-500 border-0 flex items-center">
                        <RocketOutlined />
                        一键应用全部建议
                      </Button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </Card>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
