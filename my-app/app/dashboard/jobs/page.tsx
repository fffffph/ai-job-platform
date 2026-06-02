"use client";

import React from 'react';
import { Card, Table, Tag, Button, Input, Space } from 'antd';
import { SearchOutlined, FilterOutlined } from '@ant-design/icons';
import { motion } from 'framer-motion';

export default function JobsPage() {
  const columns = [
    {
      title: '职位名称',
      dataIndex: 'title',
      key: 'title',
      render: (text: string) => <span className="text-foreground font-medium">{text}</span>,
    },
    {
      title: '公司',
      dataIndex: 'company',
      key: 'company',
      render: (text: string) => <span className="text-muted-foreground">{text}</span>,
    },
    {
      title: '匹配度',
      dataIndex: 'match',
      key: 'match',
      render: (match: number) => (
        <Tag color={match > 90 ? 'gold' : 'blue'} className="border-0 bg-opacity-20">
          {match}% 匹配
        </Tag>
      ),
    },
    {
      title: '薪资',
      dataIndex: 'salary',
      key: 'salary',
      render: (text: string) => <span className="text-green-500 dark:text-green-400 font-mono">{text}</span>,
    },
    {
      title: '操作',
      key: 'action',
      render: () => (
        <Button type="primary" size="small">查看详情</Button>
      ),
    },
  ];

  const data = [
    { key: '1', title: '高级前端工程师', company: '字节跳动', match: 95, salary: '30k-50k' },
    { key: '2', title: 'React 开发专家', company: '腾讯', match: 92, salary: '35k-60k' },
    { key: '3', title: '全栈工程师', company: '阿里巴巴', match: 88, salary: '25k-45k' },
    { key: '4', title: '前端架构师', company: '美团', match: 91, salary: '40k-70k' },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.5 }}
      className="p-8"
    >
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-2xl font-bold text-foreground m-0">职位发现</h1>
        <Space>
          <Input 
            prefix={<SearchOutlined />} 
            placeholder="搜索职位或公司" 
            className="bg-card/50 border-border text-foreground w-64"
          />
          <Button icon={<FilterOutlined />} className="bg-card/50 border-border text-foreground">筛选</Button>
        </Space>
      </div>

      <Card className="bg-card/50 border-border">
        <Table 
          columns={columns} 
          dataSource={data} 
          pagination={false}
          className="ant-table-transparent"
        />
      </Card>
    </motion.div>
  );
}
