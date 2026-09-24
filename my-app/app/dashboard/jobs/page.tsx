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
  Switch,
  Tooltip,
} from "antd";
import {
  ThunderboltOutlined,
  EnvironmentOutlined,
  ToolOutlined,
  DollarOutlined,
  LinkOutlined,
  CopyOutlined,
  QuestionCircleOutlined,
} from "@ant-design/icons";
import { motion } from "framer-motion";
import { recommendJobsStream, getJobProfileApi } from "@/api";
import type { TraceEvent, ReasoningEntry, JobRecommendation } from "@/api";
import AITracePanel from "@/components/AITracePanel";
import ThinkingPanel from "@/components/ThinkingPanel";
import { useThinkingPreference } from "@/hooks/useThinkingPreference";

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

  // ========== 深度思考状态 ==========
  /** 本次请求后端是否开启了深度思考（meta 事件下发） */
  const [thinkingEnabled, setThinkingEnabled] = useState(false);
  /** 是否正在思考（ReAct 每轮开始前点亮，该轮思考结果到达后熄灭） */
  const [thinkingActive, setThinkingActive] = useState(false);
  /** 已到达的思考过程（ReAct 多轮 → 多段） */
  const [reasoningEntries, setReasoningEntries] = useState<ReasoningEntry[]>([]);

  /**
   * 深度思考开关偏好。
   *
   * effective = 全局熔断（配置中心 switch.deep_thinking）∩ 用户本地偏好，
   * 这才是真正下发给后端的值；后端还会再判定一次，并以 meta 事件回传结论。
   */
  const thinking = useThinkingPreference();

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
    // 重置思考面板，避免上一轮的内容残留
    setThinkingEnabled(false);
    setThinkingActive(false);
    setReasoningEntries([]);

    // 用局部变量而不是 state 记录「后端是否开启思考」：
    // onStart 之后的多个回调由同一个 SSE 循环连续触发，
    // 此时 React 的 state 还没提交，读 state 会拿到旧值。
    let thinkingOn = false;

    await recommendJobsStream(
      {
        city: city.trim(),
        skills: skills.trim(),
        expectedSalary: expectedSalary.trim(),
      },
      {
        onStart: (meta) => {
          thinkingOn = meta?.thinking?.enabled === true;
          setThinkingEnabled(thinkingOn);
          // Agent 起来后第一件事就是推理，立即点亮思考中
          if (thinkingOn) setThinkingActive(true);
          setPhase("Agent 正在分析求职意向…");
        },
        onReasoning: (entry) => {
          // 本轮思考结束：累积内容并熄灯（下一轮开始时再点亮）
          setReasoningEntries((prev) => [...prev, entry]);
          setThinkingActive(false);
        },
        onAgentAction: (action) => {
          if (action === "call_tools") {
            setSearchRounds((n) => n + 1);
            setPhase("Agent 正在搜索职位库…");
            // 下一步会回到 agent 再推理一轮
            if (thinkingOn) setThinkingActive(true);
          } else {
            setPhase("搜索完成，正在生成推荐…");
          }
        },
        onToolsDone: () => {
          setPhase("已获取职位数据，Agent 继续分析…");
          // 工具执行完，回到 agent 再思考一轮
          if (thinkingOn) setThinkingActive(true);
        },
        onFinalize: () => setPhase("正在生成推荐原因与招呼语…"),
        onTrace: (events) => {
          // 【P6】接收节点级 trace，供 AI Trace 面板展示决策过程
          setTraceEvents(events);
        },
        onRecommendations: (result) => {
          setRecommendation(result);
          setPhase("");
          setThinkingActive(false);
          // 【P5】推荐成功 → 画像已由后端自动保存，提示用户已记住偏好
          setRemembered(true);
        },
        onError: (msg) => {
          setError(msg);
          setPhase("");
          setThinkingActive(false);
        },
      },
      {
        // 会话级意图：后端还会叠加全局熔断，最终以后端 meta 回传的结论为准
        thinking: thinking.effective,
      }
    );

    // 兜底熄灯：覆盖异常中断的情况
    setThinkingActive(false);
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

        {/* 深度思考开关：默认关闭，开启后 Agent 每轮决策都会先推理再行动 */}
        <div
          style={{
            marginTop: 12,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <Switch
            size="small"
            checked={thinking.effective}
            disabled={!thinking.available}
            onChange={thinking.setEnabled}
          />
          <Text style={{ fontSize: 13 }}>深度思考</Text>
          <Tooltip
            title={
              thinking.available
                ? "开启后 Agent 每一轮决策都会先推理再行动：搜索策略更合理，但整体耗时明显变长（可能一到两分钟）。推理过程会展示在下方，可展开查看。"
                : "管理员已在系统设置中关闭「深度思考」能力"
            }
          >
            <QuestionCircleOutlined
              style={{ color: "var(--muted-foreground, #999)", cursor: "help" }}
            />
          </Tooltip>
          {!thinking.available && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              已由管理员关闭
            </Text>
          )}
        </div>
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

      {/* 【深度思考】思考过程面板：ReAct 多轮会累积多段，按节点分段展示。
          放在加载卡片之外，这样请求结束后仍可回看。 */}
      {thinkingEnabled && (thinkingActive || reasoningEntries.length > 0) && (
        <div style={{ marginBottom: 24 }}>
          <ThinkingPanel active={thinkingActive} entries={reasoningEntries} />
        </div>
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
