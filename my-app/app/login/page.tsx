"use client";

import React from 'react';
import { Form, Input, Button, Checkbox, Card, ConfigProvider, theme, message, App } from 'antd';
import { Mail, Lock, LogIn, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { motion } from 'framer-motion';

/**
 * 登录页 - 黑色科技风
 */
const LoginContent = () => {
  const { message } = App.useApp();
  const [form] = Form.useForm();

  const onFinish = (values: any) => {
    console.log('Login attempt:', values);
    if (values.email === 'admin@example.com' && values.password === '123456') {
      message.success('登录成功！');
    } else {
      message.error('登录失败！');
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[#050505] relative overflow-hidden font-sans">
      {/* 背景装饰 - 科技感线条/光影 */}
      <div className="absolute inset-0 z-0">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-blue-600/10 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-indigo-600/10 rounded-full blur-[120px]" />
        
        {/* 网格背景 */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px),linear-gradient(to_bottom,#ffffff05_1px,transparent_1px)] bg-[size:40px_40px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)]" />
      </div>

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="relative z-10 w-full max-w-md px-6"
      >
        <Card 
          className="backdrop-blur-2xl bg-black/40 border-white/10 shadow-[0_0_50px_-12px_rgba(59,130,246,0.3)]"
          styles={{ body: { padding: '2rem' } }}
        >
          <div className="text-center mb-8">
            <motion.div 
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
            >
              <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-b from-white to-white/60 bg-clip-text text-transparent mb-2">
                账号登录
              </h1>
              <p className="text-white/40 text-sm font-medium">开启您的 AI 职业生涯新篇章</p>
            </motion.div>
          </div>

          <Form
            form={form}
            layout="vertical"
            onFinish={onFinish}
            autoComplete="off"
            size="large"
            requiredMark={false}
          >
            <Form.Item
              name="email"
              label={<span className="text-white/60 text-xs font-semibold uppercase tracking-wider">邮箱地址</span>}
              rules={[
                { required: true, message: '请输入您的邮箱！' },
                { type: 'email', message: '请输入有效的邮箱地址！' }
              ]}
            >
              <Input 
                prefix={<Mail className="w-4 h-4 text-white/30 mr-2" />} 
                placeholder="name@example.com" 
                className="hover:border-blue-500/50 focus:border-blue-500 transition-all"
              />
            </Form.Item>

            <Form.Item
              name="password"
              label={<span className="text-white/60 text-xs font-semibold uppercase tracking-wider">登录密码</span>}
              rules={[{ required: true, message: '请输入您的密码！' }]}
            >
              <Input.Password
                prefix={<Lock className="w-4 h-4 text-white/30 mr-2" />}
                placeholder="••••••••"
                className="hover:border-blue-500/50 focus:border-blue-500 transition-all"
              />
            </Form.Item>

            <div className="flex items-center justify-between mb-8">
              <Form.Item name="remember" valuePropName="checked" noStyle>
                <Checkbox className="text-white/40 text-sm hover:text-white/60 transition-colors">记住我</Checkbox>
              </Form.Item>
              <a className="text-sm text-blue-400 hover:text-blue-300 transition-colors font-medium" href="#">
                忘记密码？
              </a>
            </div>

            <Form.Item className="mb-0">
              <Button 
                type="primary" 
                htmlType="submit" 
                block 
                icon={<LogIn className="w-4 h-4" />}
                className="bg-blue-600 hover:bg-blue-500 border-none shadow-lg shadow-blue-900/20 font-bold tracking-wide"
              >
                立即登录
              </Button>
            </Form.Item>

            <div className="mt-8 pt-6 border-t border-white/5 text-center">
              <p className="text-white/40 text-sm">
                还没有账号？{' '}
                <Link href="/register" className="text-white hover:text-blue-400 transition-all inline-flex items-center font-semibold">
                  点击注册 <UserPlus className="ml-1.5 w-4 h-4" />
                </Link>
              </p>
            </div>
          </Form>
        </Card>

        {/* 底部版权或其他信息 */}
        <div className="mt-8 text-center text-white/20 text-xs tracking-widest uppercase">
          © 2026 CareerAI Technology
        </div>
      </motion.div>
    </div>
  );
};

const LoginPage = () => {
  return (
    <ConfigProvider
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: '#3b82f6',
          borderRadius: 12,
          colorBgContainer: 'rgba(0, 0, 0, 0.4)',
        },
        components: {
          Input: {
            colorBgContainer: 'rgba(255, 255, 255, 0.05)',
            colorBorder: 'rgba(255, 255, 255, 0.1)',
          },
          Button: {
            controlHeightLG: 48,
          }
        }
      }}
    >
      <App>
        <LoginContent />
      </App>
    </ConfigProvider>
  );
};

export default LoginPage;
