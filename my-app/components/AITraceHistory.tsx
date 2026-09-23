"use client";

/**
 * ============================================
 * AITraceHistory —— AI 决策历史面板
 * ============================================
 *
 * 【职责】
 * 展示当前用户历史上的每次 AI 执行记录（P6 落库后数据），
 * 点击任意一条可「回放」该次 AI 的完整决策过程：
 *   - 列表：时间 / 类型 / 状态 / 节点数 / 总耗时
 *   - 回放：弹窗内复用 AITracePanel 渲染每一步输入输出
 *
 * 【与实时 Trace 的关系】
 * 实时 trace（SSE 推送）是「边跑边看」，
 * 本组件是「跑完随时回看」，互补组成完整的可观测闭环。
 *
 * 【数据来源】
 * - GET /api/ai/trace/runs       → 历史列表（轻量）
 * - GET /api/ai/trace/runs/:id   → 单次详情（含事件，点击回放时拉取）
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  Card,
  List,
  Tag,
  Space,
  Spin,
  Empty,
  Button,
  Modal,
  Typography,
  App,
} from "antd";
import {
  FileTextOutlined,
  BookOutlined,
  ThunderboltOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ReloadOutlined,
  EyeOutlined,
  HistoryOutlined,
} from "@ant-design/icons";
import { listTraceRunsApi, getTraceRunApi } from "@/api";
import type { TraceRunListItem, TraceRunDetail } from "@/api";
import AITracePanel from "@/components/AITracePanel";

const { Text } = Typography;

/** 图类型 → 展示元信息（中文名 / 标签颜色 / 图标） */
const TYPE_META: Record<
  string,
  { label: string; color: string; icon: React.ReactNode }
> = {
  resume: { label: "简历分析", color: "purple", icon: <FileTextOutlined /> },
  rag: { label: "知识库问答", color: "cyan", icon: <BookOutlined /> },
  jobs: { label: "职位发现", color: "blue", icon: <ThunderboltOutlined /> },
};

/** 执行状态 → 展示元信息 */
const STATUS_META: Record<string, { label: string; color: string }> = {
  success: { label: "成功", color: "green" },
  error: { label: "失败", color: "red" },
};

/**
 * 把 ISO 时间格式化为本地「YYYY-MM-DD HH:mm:ss」。
 * 无效时间返回空串，避免显示 NaN。
 */
function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/**
 * 把耗时（毫秒）格式化为可读文本。
 * <1000ms → "850ms"；≥1000ms → "1.23s"。
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/** 获取图类型元信息（未知类型降级为灰色「其他」） */
function getTypeMeta(type: string) {
  return (
    TYPE_META[type] ?? {
      label: type || "其他",
      color: "default",
      icon: <HistoryOutlined />,
    }
  );
}

const AITraceHistory: React.FC = () => {
  const { message } = App.useApp();

  // ========== 历史列表状态 ==========
  const [loading, setLoading] = useState(false);
  const [runs, setRuns] = useState<TraceRunListItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  // ========== 回放弹窗状态 ==========
  const [modalOpen, setModalOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<TraceRunDetail | null>(null);

  /**
   * 加载历史列表。
   * 首次进入和手动刷新都调用；失败时只提示，不阻塞页面。
   */
  const load = useCallback(async () => {
    setLoading(true);
    const res = await listTraceRunsApi();
    if (res.success && res.data) {
      setRuns(res.data);
    } else {
      message.error(res.message || "读取 AI 决策历史失败");
    }
    setLoaded(true);
    setLoading(false);
  }, [message]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * 查看某次执行的完整决策回放。
   * 打开弹窗后立即拉取详情，加载完成后复用 AITracePanel 渲染。
   */
  const handleView = async (run: TraceRunListItem) => {
    setModalOpen(true);
    setDetail(null);
    setDetailLoading(true);

    const res = await getTraceRunApi(run.id);
    if (res.success && res.data) {
      setDetail(res.data);
    } else {
      message.error(res.message || "读取 AI 决策详情失败");
      // 详情失败时关闭弹窗，避免停留在空加载态
      setModalOpen(false);
    }
    setDetailLoading(false);
  };

  return (
    <Card
      title={
        <Space>
          <HistoryOutlined style={{ color: "#3b82f6" }} />
          <span>AI 决策历史</span>
        </Space>
      }
      extra={
        <Button
          size="small"
          icon={<ReloadOutlined />}
          onClick={load}
          loading={loading}
        >
          刷新
        </Button>
      }
      style={{ borderRadius: 12 }}
      styles={{ body: { padding: "16px 20px" } }}
    >
      {/* 首次加载中 */}
      {loading && !loaded && (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            padding: "40px 0",
          }}
        >
          <Spin size="large" />
        </div>
      )}

      {/* 空状态 */}
      {loaded && !loading && runs.length === 0 && (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <span>
              暂无 AI 决策记录，去「简历分析 / 知识库问答 / 职位发现」跑一次即可留存
            </span>
          }
        />
      )}

      {/* 历史列表 */}
      {runs.length > 0 && (
        <List
          dataSource={runs}
          renderItem={(run) => {
            const typeMeta = getTypeMeta(run.type);
            const statusMeta = STATUS_META[run.status] ?? {
              label: run.status || "未知",
              color: "default",
            };
            return (
              <List.Item
                style={{ paddingInline: 0 }}
                actions={[
                  <Button
                    key="view"
                    type="link"
                    size="small"
                    icon={<EyeOutlined />}
                    onClick={() => handleView(run)}
                  >
                    回放
                  </Button>,
                ]}
              >
                <List.Item.Meta
                  avatar={
                    <span
                      style={{
                        fontSize: 18,
                        color: "var(--muted-foreground, #888)",
                      }}
                    >
                      {typeMeta.icon}
                    </span>
                  }
                  title={
                    <Space size={8} wrap>
                      <Tag color={typeMeta.color} style={{ marginInlineEnd: 0 }}>
                        {typeMeta.label}
                      </Tag>
                      {run.status === "success" ? (
                        <CheckCircleOutlined
                          style={{ color: "#52c41a", fontSize: 13 }}
                        />
                      ) : (
                        <CloseCircleOutlined
                          style={{ color: "#ff4d4f", fontSize: 13 }}
                        />
                      )}
                      <Tag
                        color={statusMeta.color}
                        style={{ marginInlineEnd: 0 }}
                      >
                        {statusMeta.label}
                      </Tag>
                    </Space>
                  }
                  description={
                    <Space size={12} wrap>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        🕐 {formatDateTime(run.createdAt)}
                      </Text>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        节点 {run.nodeCount} 个
                      </Text>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        总耗时 {formatDuration(run.totalDurationMs)}
                      </Text>
                    </Space>
                  }
                />
              </List.Item>
            );
          }}
        />
      )}

      {/* 回放弹窗：复用 AITracePanel 展示完整决策过程 */}
      <Modal
        title={
          detail
            ? `🔍 决策回放 · ${getTypeMeta(detail.type).label}`
            : "🔍 决策回放"
        }
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        footer={null}
        width={880}
        style={{ top: 40 }}
        destroyOnClose
      >
        {detailLoading && (
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              padding: "40px 0",
            }}
          >
            <Spin size="large" />
          </div>
        )}
        {!detailLoading && detail && (
          <AITracePanel events={detail.events} />
        )}
        {!detailLoading && !detail && (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="暂无决策详情"
          />
        )}
      </Modal>
    </Card>
  );
};

export default AITraceHistory;
