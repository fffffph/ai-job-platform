"use client";

import React from 'react';
import { Card, Row, Col, Statistic, Avatar, Tag, Button, theme, Flex } from 'antd';
import { 
  ProjectOutlined, 
  FileTextOutlined, 
  ThunderboltOutlined,
  BellOutlined,
} from '@ant-design/icons';
import { motion } from 'framer-motion';

/**
 * Dashboard 工作台主页内容
 */
export default function DashboardPage() {
  const stats = [
    { title: '职位匹配度', value: 92, suffix: '%', icon: <ThunderboltOutlined className="text-yellow-500" /> },
    { title: '待面试', value: 3, suffix: '场', icon: <ProjectOutlined className="text-blue-500" /> },
    { title: '简历优化度', value: 85, suffix: '%', icon: <FileTextOutlined className="text-green-500" /> },
    { title: '消息通知', value: 12, suffix: '条', icon: <BellOutlined className="text-purple-500" /> },
  ];

  const recentActivities = [
    { title: '字节跳动 - 前端开发工程师', status: '面试邀约', date: '2026-05-22', color: 'blue' },
    { title: '腾讯 - AI 研究员', status: '已投递', date: '2026-05-21', color: 'cyan' },
    { title: '阿里 - 产品经理', status: '简历通过', date: '2026-05-20', color: 'green' },
  ];

  return (
    <div className="p-8">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        {/* 数据统计 */}
        <Row gutter={[24, 24]}>
          {stats.map((item, index) => (
            <Col xs={24} sm={12} lg={6} key={index}>
              <Card className="bg-card/50 border-border hover:border-primary/50 transition-all">
                <Statistic
                  title={<span className="text-muted-foreground">{item.title}</span>}
                  value={item.value}
                  suffix={item.suffix}
                  prefix={item.icon}
                  styles={{ content: { color: 'var(--foreground)', fontWeight: 'bold' } }}
                />
              </Card>
            </Col>
          ))}
        </Row>

        <Row gutter={[24, 24]} className="mt-8">
          {/* 最近活动 */}
          <Col xs={24} lg={16}>
            <Card 
              title={<span className="text-foreground">最近动态</span>}
              className="bg-card/50 border-border h-full"
              extra={<a href="#" className="text-primary hover:text-primary/80">查看全部</a>}
            >
              <div className="space-y-4">
                {recentActivities.map((item, index) => (
                  <Flex 
                    key={index} 
                    align="center" 
                    justify="space-between" 
                    className="py-3 border-b border-border last:border-0"
                  >
                    <Flex gap="middle" align="center">
                      <Avatar icon={<ProjectOutlined />} className="bg-primary/20 text-primary" />
                      <div>
                        <div className="text-foreground/80 font-medium">{item.title}</div>
                        <div className="text-muted-foreground text-xs">{item.date}</div>
                      </div>
                    </Flex>
                    <Tag color={item.color} className="border-0 bg-opacity-20 m-0">{item.status}</Tag>
                  </Flex>
                ))}
              </div>
            </Card>
          </Col>

          {/* 快捷操作 */}
          <Col xs={24} lg={8}>
            <Card 
              title={<span className="text-foreground">AI 智能助手</span>}
              className="bg-card/50 border-border h-full"
            >
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-blue-600/10 border border-blue-500/20">
                  <p className="text-blue-500 dark:text-blue-400 text-sm mb-3">AI 发现你有 5 个高度匹配的新职位，是否立即查看？</p>
                  <Button type="primary" size="small" block>立即匹配</Button>
                </div>
                <div className="p-4 rounded-xl bg-purple-600/10 border border-purple-500/20">
                  <p className="text-purple-500 dark:text-purple-400 text-sm mb-3">您的简历可以针对“算法工程师”岗位进行定向优化。</p>
                  <Button type="primary" size="small" block className="bg-purple-600 border-none hover:bg-purple-500">简历优化</Button>
                </div>
              </div>
            </Card>
          </Col>
        </Row>
      </motion.div>
    </div>
  );
}
