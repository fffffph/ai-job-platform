"use client";

/**
 * ============================================
 * KnowledgeBasePanel —— 工作台「个人知识库」面板
 * ============================================
 *
 * 【职责】
 * 工作台页面的 RAG 知识库交互面板，包含两个能力：
 * 1. 上传文档：标题 + 内容 → 分块 + 向量化 + 入库（P3）
 * 2. 智能问答：提问 → 向量检索 + LLM 增强生成，带引用来源
 *
 * 【交互流程】
 * - 上传：填写标题/内容 → 点击上传 → 提示入库结果
 * - 问答：输入问题 → 流式展示「检索命中的分块」→「带引用的回答」
 *
 * 【主题适配】
 * 全部使用 Antd 组件，主应用 dashboard/layout 已配置 algorithm 切换，
 * 因此暗色/亮色自动响应，无需额外写颜色变量。
 */

import React, { useState } from "react";
import {
  Card,
  Tabs,
  Input,
  Button,
  List,
  Tag,
  Space,
  Spin,
  Alert,
  Empty,
  Typography,
} from "antd";
import {
  UploadOutlined,
  SearchOutlined,
  FileTextOutlined,
  BulbOutlined,
} from "@ant-design/icons";
import { uploadKnowledgeApi, askKnowledgeStream } from "@/api";
import type { RetrievedChunk, TraceEvent } from "@/api";
import AITracePanel from "@/components/AITracePanel";

const { TextArea } = Input;
const { Paragraph, Text } = Typography;

/** 上传结果的提示信息 */
interface UploadNotice {
  type: "success" | "error";
  text: string;
}

const KnowledgeBasePanel: React.FC = () => {
  // ========== 上传文档状态 ==========
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadNotice, setUploadNotice] = useState<UploadNotice | null>(null);

  // ========== 智能问答状态 ==========
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [chunks, setChunks] = useState<RetrievedChunk[]>([]);
  const [answer, setAnswer] = useState("");
  const [askError, setAskError] = useState<string | null>(null);
  const [traceEvents, setTraceEvents] = useState<TraceEvent[]>([]);

  /**
   * 上传文档到知识库。
   * 成功后清空表单并提示分块数量；失败展示后端返回的中文错误。
   */
  const handleUpload = async () => {
    if (!title.trim() || !content.trim()) {
      setUploadNotice({
        type: "error",
        text: "请填写文档标题和内容",
      });
      return;
    }

    setUploading(true);
    setUploadNotice(null);

    const res = await uploadKnowledgeApi(title.trim(), content.trim());

    if (res.success) {
      setUploadNotice({
        type: "success",
        // 防御性可选链：即使后端返回格式异常也不至于白屏
        text: `文档已入库，自动切分为 ${res.data?.chunkCount ?? 0} 个片段，可开始提问`,
      });
      setTitle("");
      setContent("");
    } else {
      setUploadNotice({ type: "error", text: res.message });
    }

    setUploading(false);
  };

  /**
   * 发起知识库问答。
   * 流式回调：先展示检索命中的分块，再展示带引用的回答。
   */
  const handleAsk = async () => {
    if (!question.trim() || asking) {
      return;
    }

    setAsking(true);
    setAskError(null);
    setChunks([]);
    setAnswer("");
    setTraceEvents([]);

    await askKnowledgeStream(question.trim(), {
      onStart: () => {
        // 开始检索，无需额外处理（chunks 会在 onRetrieve 回调中填充）
      },
      onRetrieve: (retrieved) => {
        setChunks(retrieved);
      },
      onAnswer: (generated) => {
        setAnswer(generated);
      },
      onTrace: (events) => {
        // 【P6】接收节点级 trace，供 AI Trace 面板展示检索/生成过程
        setTraceEvents(events);
      },
      onDone: (result) => {
        setChunks(result.chunks);
        setAnswer(result.answer);
      },
      onError: (message) => {
        setAskError(message);
      },
    });

    setAsking(false);
  };

  // ========== 渲染：上传文档 Tab ==========
  const renderUploadTab = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Space orientation="vertical" style={{ width: "100%" }} size={12}>
        <Input
          placeholder="文档标题，如「React 面试笔记」"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={100}
          prefix={<FileTextOutlined />}
        />
        <TextArea
          placeholder="粘贴文档内容（面试题、JD、学习笔记等）。建议超过 512 字以触发分块。"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          autoSize={{ minRows: 6, maxRows: 12 }}
        />
        <Button
          type="primary"
          icon={<UploadOutlined />}
          loading={uploading}
          onClick={handleUpload}
          disabled={!title.trim() || !content.trim()}
        >
          上传到知识库
        </Button>
      </Space>

      {uploadNotice && (
        <Alert
          type={uploadNotice.type}
          showIcon
          message={uploadNotice.text}
        />
      )}
    </div>
  );

  // ========== 渲染：智能问答 Tab ==========
  const renderAskTab = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Space.Compact style={{ width: "100%" }}>
        <Input
          placeholder="就知识库内容提问，如「React 虚拟 DOM 的优势有哪些？」"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onPressEnter={handleAsk}
          prefix={<SearchOutlined />}
        />
        <Button
          type="primary"
          icon={<BulbOutlined />}
          loading={asking}
          onClick={handleAsk}
          disabled={!question.trim()}
        >
          提问
        </Button>
      </Space.Compact>

      {askError && <Alert type="error" showIcon message={askError} />}

      {/* 检索结果 */}
      {chunks.length > 0 && (
        <div>
          <Text type="secondary" style={{ fontSize: 13 }}>
            检索到 {chunks.length} 个相关知识片段：
          </Text>
          <List
            size="small"
            dataSource={chunks}
            renderItem={(chunk, index) => (
              <List.Item
                key={index}
                style={{ alignItems: "flex-start", paddingInline: 0 }}
              >
                <div style={{ width: "100%" }}>
                  <Space size={8} style={{ marginBottom: 4 }} wrap>
                    <Tag color="blue">[{index + 1}] {chunk.documentTitle}</Tag>
                    <Tag color="green">
                      相似度 {(chunk.score * 100).toFixed(1)}%
                    </Tag>
                  </Space>
                  <Paragraph
                    type="secondary"
                    ellipsis={{ rows: 2, expandable: true, symbol: "展开" }}
                    style={{ marginBottom: 0, fontSize: 13 }}
                  >
                    {chunk.content}
                  </Paragraph>
                </div>
              </List.Item>
            )}
          />
        </div>
      )}

      {/* AI 回答 */}
      {asking && !answer && chunks.length === 0 && (
        <div style={{ textAlign: "center", padding: "24px 0" }}>
          <Spin tip="正在检索知识库…" />
        </div>
      )}
      {answer && (
        <div
          style={{
            background: "var(--bg-soft, #fafafa)",
            border: "1px solid var(--border, #e8e8e8)",
            borderRadius: 8,
            padding: "12px 16px",
          }}
        >
          <Text strong style={{ display: "block", marginBottom: 8 }}>
            💡 AI 回答（基于你的知识库）
          </Text>
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
        </div>
      )}

      {/* AI 决策过程（P6 可观测） */}
      {traceEvents.length > 0 && <AITracePanel events={traceEvents} />}

      {!asking && !answer && chunks.length === 0 && !askError && (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="上传文档后，就可以在这里就知识库内容提问"
        />
      )}
    </div>
  );

  return (
    <Card
      title="📚 个人知识库（RAG）"
      style={{ borderRadius: 12 }}
      styles={{ body: { padding: 16 } }}
    >
      <Tabs
        items={[
          {
            key: "upload",
            label: "上传文档",
            children: renderUploadTab(),
          },
          {
            key: "ask",
            label: "智能问答",
            children: renderAskTab(),
          },
        ]}
      />
    </Card>
  );
};

export default KnowledgeBasePanel;
