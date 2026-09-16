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
 * 3. 实时展示 Agent 决策过程（搜索几轮）+ 最终带理由的推荐
 *
 * 【学习导向】
 * 加载过程中展示「Agent 正在搜索…」「已获取职位数据…」等阶段提示，
 * 让用户看到 Agent 的自主规划过程，而非黑盒等待。
 */

import React, { useState, useEffect } from "react";
import { Card, Input, Button, Space, Alert, Spin, Empty, Tag } from "antd";
import {
  SearchOutlined,
  ThunderboltOutlined,
  EnvironmentOutlined,
  ToolOutlined,
  DollarOutlined,
} from "@ant-design/icons";
import { motion } from "framer-motion";
import { recommendJobsStream, getJobProfileApi } from "@/api";

const JobsPage: React.FC = () => {
  // ========== 求职意向表单状态 ==========
  const [city, setCity] = useState("");
  const [skills, setSkills] = useState("");
  const [expectedSalary, setExpectedSalary] = useState("");

  // ========== 推荐过程状态 ==========
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState("");
  const [searchRounds, setSearchRounds] = useState(0);
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [remembered, setRemembered] = useState(false);

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
   * 发起职位推荐。
   * 流式回调实时更新阶段提示 + 搜索轮数，最终展示推荐文本。
   */
  const handleRecommend = async () => {
    if (loading) return;

    setLoading(true);
    setError(null);
    setAnswer("");
    setRemembered(false);
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
            setPhase("Agent 正在整理推荐结果…");
          }
        },
        onToolsDone: () => setPhase("已获取职位数据，Agent 继续分析…"),
        onDone: (finalAnswer) => {
          setAnswer(finalAnswer);
          setPhase("");
          // 【P5】推荐成功 → 画像已由后端自动保存，提示用户已记住偏好
          setRemembered(true);
        },
        onError: (message) => {
          setError(message);
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

      {/* 推荐结果 */}
      {answer && (
        <Card
          title="💼 推荐结果"
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
          <div
            style={{
              whiteSpace: "pre-wrap",
              lineHeight: 1.7,
              fontSize: 14,
              color: "var(--foreground, #1a1a1a)",
            }}
          >
            {answer}
          </div>
        </Card>
      )}

      {/* 空状态 */}
      {!loading && !answer && !error && (
        <Card style={{ borderRadius: 12 }}>
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <span>
                填写求职意向（可选）后点击「
                <ThunderboltOutlined /> 智能推荐」，Agent 会自主搜索职位库并推荐匹配岗位
              </span>
            }
          />
        </Card>
      )}
    </motion.div>
  );
};

export default JobsPage;
