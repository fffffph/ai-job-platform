"use client";

import React from 'react';
import { Card, Avatar, Form, Input, Button, Row, Col } from 'antd';
import { UserOutlined, MailOutlined, PhoneOutlined, GithubOutlined, LinkedinOutlined } from '@ant-design/icons';
import { motion } from 'framer-motion';

export default function ProfilePage() {
  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.5 }}
      className="p-8"
    >
      <h1 className="text-2xl font-bold text-foreground mb-8">个人中心</h1>

      <Row gutter={24}>
        <Col xs={24} lg={8}>
          <Card className="bg-card/50 border-border text-center py-8">
            <Avatar size={100} icon={<UserOutlined />} className="bg-primary mb-4" />
            <h2 className="text-foreground text-xl font-bold m-0">求职者甲</h2>
            <p className="text-muted-foreground">高级前端开发工程师</p>
            
            <div className="flex justify-center gap-4 mt-6">
              <Button shape="circle" icon={<GithubOutlined />} className="bg-card/50 border-border text-muted-foreground hover:text-foreground" />
              <Button shape="circle" icon={<LinkedinOutlined />} className="bg-card/50 border-border text-muted-foreground hover:text-foreground" />
            </div>
          </Card>
        </Col>

        <Col xs={24} lg={16}>
          <Card title={<span className="text-foreground">基本信息</span>} className="bg-card/50 border-border">
            <Form layout="vertical">
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item label={<span className="text-muted-foreground">姓名</span>}>
                    <Input defaultValue="求职者甲" className="bg-card/50 border-border text-foreground" />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label={<span className="text-muted-foreground">邮箱</span>}>
                    <Input prefix={<MailOutlined />} defaultValue="admin@example.com" className="bg-card/50 border-border text-foreground" />
                  </Form.Item>
                </Col>
              </Row>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item label={<span className="text-muted-foreground">电话</span>}>
                    <Input prefix={<PhoneOutlined />} defaultValue="138-0000-0000" className="bg-card/50 border-border text-foreground" />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label={<span className="text-muted-foreground">所在地</span>}>
                    <Input defaultValue="上海" className="bg-card/50 border-border text-foreground" />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item label={<span className="text-muted-foreground">自我介绍</span>}>
                <Input.TextArea rows={4} className="bg-card/50 border-border text-foreground" />
              </Form.Item>
              <Form.Item className="mb-0">
                <Button type="primary">保存修改</Button>
              </Form.Item>
            </Form>
          </Card>
        </Col>
      </Row>
    </motion.div>
  );
}
