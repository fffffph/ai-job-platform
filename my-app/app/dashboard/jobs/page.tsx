"use client";

/**
 * ============================================
 * JobsPage —— 职位发现页面
 * ============================================
 *
 * 【职责】
 * 职位发现 Agent 的交互页面：
 * 1. 求职意向表单（期望城市 / 技能栈 / 期望薪资，均可选）
 * 2. 触发 ReAct Agent 自主规划搜索职位
 * 3. 展示结构化推荐结果：每条职位含「推荐原因 + BOSS直达链接 + 一键招呼语」
 *
 * 【直达链接方案】
 * 每条推荐职位附 BOSS直聘真实搜索链接，点击跳转（合规，不抓取数据），
 * 用户用已登录的 BOSS直聘账号直接沟通投递。
 */

import React, { useState, useEffect } from "react";
import {
  Card,
  Input,
  Button,
  Space,
  Alert,
  Spin,
  Empty,
  Tag,
  List,
  Typography,
  App,
  Divider,
} from "antd";
import {
  ThunderboltOutlined,
  EnvironmentOutlined,
  ToolOutlined,
  DollarOutlined,
  LinkOutlined,
  CopyOutlined,
} from "@ant-design/icons";
import { motion } from "framer-motion";
import { recommendJobsStream, getJobProfileApi } from "@/api";
import type { TraceEvent, JobRecommendation } from "@/api";
import AITracePanel from "@/components/AITracePanel";

const { Text, Paragraph } = Typography;

const JobsPage: React.FC = () => {
  const { message } = App.useApp();

  // ========== 求职意向表单状态 ==========
  const [city, setCity] = useState("");
  const [skills, setSkills] = useState("");
  const [expectedSalary, setExpectedSalary] = useState("");

  // ========== 推荐过程状态 ==========
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState("");
  const [searchRounds, setSearchRounds] = useState(0);
  const [recommendation, setRecommendation] =
    useState<JobRecommendation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [remembered, setRemembered] = useState(false);
  const [traceEvents, setTraceEvents] = useState<TraceEvent[]>([]);

  // 【P5】加载时读取已保存的求职画像，回填表单（跨轮记忆）
  useEffect(() => {
    getJobProfileApi().then((res) => {
      if (res.success && res.data) {
        if (res.data.city) setCity(res.data.city);
        if (res.data.skills) setSkills(res.data.skills);
        if (res.data.expectedSalary) setExpectedSalary(res.data.expectedSalary);
      }
    });
  }, []);

  /**
   * 一键复制招呼语。
   * 复制成功后提示用户去 BOSS直聘粘贴。
   */
  const handleCopyGreeting = async (greeting: string) => {
    try {
      await navigator.clipboard.writeText(greeting);
      message.success("招呼语已复制，去 BOSS 直聘粘贴即可");
    } catch {
      message.error("复制失败，请手动复制");
    }
  };

  /**
   * 发起职位推荐。
   * 流式回调实时更新阶段提示 + 搜索轮数，最终展示结构化推荐。
   */
  const handleRecommend = async () => {
    if (loading) return;

    setLoading(true);
    setError(null);
    setRecommendation(null);
    setRemembered(false);
    setTraceEvents([]);
    setPhase("正在启动职位发现 Agent…");
    setSearchRounds(0);

    await recommendJobsStream(
      {
        city: city.trim(),
        skills: skills.trim(),
        expectedSalary: expectedSalary.trim(),
      },
      {
        onStart: () => setPhase("Agent 正在分析求职意向…"),
        onAgentAction: (action) => {
          if (action === "call_tools") {
            setSearchRounds((n) => n + 1);
            setPhase("Agent 正在搜索职位库…");
          } else {
            setPhase("搜索完成，正在生成推荐…");
          }
        },
        onToolsDone: () => setPhase("已获取职位数据，Agent 继续分析…"),
        onFinalize: () => setPhase("正在生成推荐原因与招呼语…"),
        onTrace: (events) => {
          // 【P6】接收节点级 trace，供 AI Trace 面板展示决策过程
          setTraceEvents(events);
        },
        onRecommendations: (result) => {
          setRecommendation(result);
          setPhase("");
          // 【P5】推荐成功 → 画像已由后端自动保存，提示用户已记住偏好
          setRemembered(true);
        },
        onError: (msg) => {
          setError(msg);
          setPhase("");
        },
      }
    );

    setLoading(false);
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.5 }}
      className="p-8"
      style={{ maxWidth: 1100, margin: "0 auto" }}
    >
      <h1 className="text-2xl font-bold text-foreground m-0 mb-8">职位发现</h1>

      {/* 求职意向表单 */}
      <Card
        title="🎯 求职意向（可选填写，越详细推荐越精准）"
        style={{ borderRadius: 12, marginBottom: 24 }}
        styles={{ body: { padding: 16 } }}
      >
        <Space wrap size={12} style={{ width: "100%" }}>
          <Input
            prefix={<EnvironmentOutlined />}
            placeholder="期望城市，如 西安"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            style={{ width: 200 }}
          />
          <Input
            prefix={<ToolOutlined />}
            placeholder="技能栈，如 React,TypeScript,微前端"
            value={skills}
            onChange={(e) => setSkills(e.target.value)}
            style={{ width: 300 }}
          />
          <Input
            prefix={<DollarOutlined />}
            placeholder="期望薪资，如 12k-18k"
            value={expectedSalary}
            onChange={(e) => setExpectedSalary(e.target.value)}
            style={{ width: 180 }}
          />
          <Button
            type="primary"
            icon={<ThunderboltOutlined />}
            loading={loading}
            onClick={handleRecommend}
          >
            智能推荐
          </Button>
        </Space>
      </Card>

      {/* 错误提示 */}
      {error && (
        <Alert
          type="error"
          showIcon
          message={error}
          style={{ marginBottom: 24 }}
        />
      )}

      {/* 加载中：展示 Agent 决策过程 */}
      {loading && (
        <Card style={{ borderRadius: 12, marginBottom: 24 }}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 16,
              padding: "32px 0",
            }}
          >
            <Spin size="large" />
            <div style={{ textAlign: "center" }}>
              <div
                style={{
                  fontSize: 16,
                  fontWeight: 500,
                  color: "var(--foreground, #1a1a1a)",
                  marginBottom: 8,
                }}
              >
                {phase}
              </div>
              {searchRounds > 0 && (
                <Tag color="blue">Agent 已自主搜索 {searchRounds} 轮</Tag>
              )}
              <div
                style={{
                  fontSize: 13,
                  color: "var(--muted-foreground, #888)",
                  marginTop: 8,
                }}
              >
                Agent 正在自主规划搜索策略，可能需要几十秒…
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* AI 决策过程（P6 可观测） */}
      {traceEvents.length > 0 && <AITracePanel events={traceEvents} />}

      {/* 结构化推荐结果 */}
      {recommendation && (
        <Card
          title={`💼 推荐结果（${recommendation.recommendations.length} 条）`}
          style={{ borderRadius: 12 }}
          styles={{ body: { padding: "16px 20px" } }}
        >
          {remembered && (
            <Alert
              type="success"
              showIcon
              message="已记住你的求职偏好，下次推荐将自动沿用"
              style={{ marginBottom: 16 }}
            />
          )}

          {/* 模拟数据说明 */}
          <Alert
            type="info"
            showIcon
            message="以下职位为模拟示例数据"
            description="职位名、公司名、薪资均为模拟数据，用于演示 AI 推荐逻辑。点击「直达 BOSS 投递」将跳转到该岗位方向的真实在招职位，实际公司名与薪资以 BOSS直聘页面为准。"
            style={{ marginBottom: 16 }}
          />

          {recommendation.summary && (
            <Paragraph type="secondary" style={{ marginBottom: 16 }}>
              {recommendation.summary}
            </Paragraph>
          )}

          <List
            dataSource={recommendation.recommendations}
            renderItem={(item, index) => (
              <List.Item
                style={{
                  alignItems: "flex-start",
                  paddingInline: 0,
                }}
              >
                <div style={{ width: "100%" }}>
                  {/* 职位基本信息 */}
                  <Space size={8} wrap style={{ marginBottom: 8 }}>
                    <Text strong style={{ fontSize: 15 }}>
                      {index + 1}. {item.jobTitle}
                    </Text>
                    <Tag color="green">{item.salary}</Tag>
                    <Text type="secondary" style={{ fontSize: 13 }}>
                      {item.city} · {item.company}
                    </Text>
                    <Tag color="default" style={{ fontSize: 12 }}>
                      示例
                    </Tag>
                  </Space>

                  {/* 推荐原因 */}
                  <div
                    style={{
                      fontSize: 13,
                      color: "var(--foreground, #1a1a1a)",
                      lineHeight: 1.7,
                      marginBottom: 8,
                    }}
                  >
                    <Text type="secondary">💡 推荐原因：</Text>
                    {item.reason}
                  </div>

                  {/* 招呼语预览 */}
                  <div
                    style={{
                      fontSize: 13,
                      lineHeight: 1.6,
                      background: "var(--bg-soft, #fafafa)",
                      border: "1px solid var(--border, #e8e8e8)",
                      borderRadius: 8,
                      padding: "8px 12px",
                      marginBottom: 12,
                      color: "var(--muted-foreground, #666)",
                    }}
                  >
                    👋 招呼语：{item.greeting}
                  </div>

                  {/* 操作按钮 */}
                  <Space wrap>
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Button
                        type="primary"
                        icon={<LinkOutlined />}
                        size="small"
                      >
                        直达 BOSS 投递
                      </Button>
                    </a>
                    <Button
                      icon={<CopyOutlined />}
                      size="small"
                      onClick={() => handleCopyGreeting(item.greeting)}
                    >
                      复制招呼语
                    </Button>
                  </Space>

                  {index < recommendation.recommendations.length - 1 && (
                    <Divider style={{ margin: "16px 0 8px" }} />
                  )}
                </div>
              </List.Item>
            )}
          />
        </Card>
      )}

      {/* 空状态 */}
      {!loading && !recommendation && !error && (
        <Card style={{ borderRadius: 12 }}>
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <span>
                填写求职意向（可选）后点击「
                <ThunderboltOutlined /> 智能推荐」，Agent 会自主搜索并推荐匹配岗位
              </span>
            }
          />
        </Card>
      )}
    </motion.div>
  );
};

export default JobsPage;
