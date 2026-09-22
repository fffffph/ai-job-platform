"use client";

import React from "react";
import { Card, Row, Col, Typography } from "antd";
import {
  FileTextOutlined,
  ThunderboltOutlined,
  UserOutlined,
  ArrowRightOutlined,
} from "@ant-design/icons";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import KnowledgeBasePanel from "@/components/KnowledgeBasePanel";

const { Title, Text } = Typography;

/**
 * Dashboard 工作台主页内容。
 * - 欢迎语；
 * - 三个真实功能入口卡片（点击跳转到对应已实现模块）；
 * - 个人知识库面板（真实数据）。
 */
export default function DashboardPage() {
  const router = useRouter();

  // 功能入口
  const features = [
    {
      title: "简历优化",
      desc: "AI 解析简历 + 岗位匹配度评估",
      icon: <FileTextOutlined style={{ fontSize: 22, color: "#3b82f6" }} />,
      path: "/dashboard/resume",
    },
    {
      title: "职位发现",
      desc: "ReAct Agent 智能推荐匹配职位",
      icon: <ThunderboltOutlined style={{ fontSize: 22, color: "#f59e0b" }} />,
      path: "/dashboard/jobs",
    },
    {
      title: "个人中心",
      desc: "配置 API Key · 求职画像",
      icon: <UserOutlined style={{ fontSize: 22, color: "#10b981" }} />,
      path: "/dashboard/profile",
    },
  ];

  return (
    <div className="p-8">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        {/* 欢迎语 */}
        <div style={{ marginBottom: 24 }}>
          <Title level={4} style={{ marginBottom: 4 }}>
            欢迎回来 👋
          </Title>
          <Text type="secondary">
            从下面的功能开始，或直接管理你的个人知识库。
          </Text>
        </div>

        {/* 功能入口卡片 */}
        <Row gutter={[24, 24]}>
          {features.map((feature, index) => (
            <Col xs={24} sm={8} key={index}>
              <Card
                hoverable
                onClick={() => router.push(feature.path)}
                style={{ borderRadius: 12, height: "100%" }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    {feature.icon}
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 500 }}>
                        {feature.title}
                      </div>
                      <div style={{ fontSize: 13, color: "var(--color-text-secondary, #666)" }}>
                        {feature.desc}
                      </div>
                    </div>
                  </div>
                  <Text type="secondary" style={{ fontSize: 12, alignSelf: "flex-end" }}>
                    进入 <ArrowRightOutlined />
                  </Text>
                </div>
              </Card>
            </Col>
          ))}
        </Row>

        {/* 个人知识库（RAG 问答 + 文件导入） */}
        <div className="mt-8">
          <KnowledgeBasePanel />
        </div>
      </motion.div>
    </div>
  );
}
