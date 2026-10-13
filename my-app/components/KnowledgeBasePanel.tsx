"use client";

/**
 * ============================================
 * KnowledgeBasePanel —— 工作台「个人知识库」面板
 * ============================================
 *
 * 【职责】
 * 工作台页面的 RAG 知识库交互面板，包含三个能力：
 * 1. 上传知识：Excel 文件批量导入（文件真相源）+ 手动单条文本；
 * 2. 我的知识：已入库条目列表（分类/检索词/分块数）+ 删除；
 * 3. 智能问答：提问 → 混合检索 + LLM 增强生成，带引用来源。
 *
 * 【文件真相源流程】
 * - 首次（无知识）：引导下载模板 → 填写 → 上传；
 * - 之后：下载上次文件 → 增删改 → 上传（同步替换）。
 *
 * 【主题适配】
 * 全部使用 Antd 组件，主应用 dashboard/layout 已配置 algorithm 切换，
 * 因此暗色/亮色自动响应，无需额外写颜色变量。
 */

import React, { useState, useEffect, useCallback } from "react";
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
  Upload,
  Radio,
  Popconfirm,
  Checkbox,
  Switch,
  Tooltip,
} from "antd";
import {
  UploadOutlined,
  SearchOutlined,
  FileTextOutlined,
  BulbOutlined,
  DownloadOutlined,
  InboxOutlined,
  DeleteOutlined,
  ReloadOutlined,
  QuestionCircleOutlined,
} from "@ant-design/icons";
import {
  uploadKnowledgeApi,
  askKnowledgeStream,
  downloadKnowledgeTemplate,
  downloadKnowledgeFile,
  getKnowledgeFileInfoApi,
  deleteKnowledgeFileApi,
  importKnowledgeFromFile,
  listKnowledgeDocuments,
  deleteKnowledgeDocument,
  parseTextToEntriesApi,
  batchImportEntries,
} from "@/api";
import type {
  RetrievedChunk,
  TraceEvent,
  ReasoningEntry,
  KnowledgeDocument,
  KnowledgeEntry,
  KnowledgeFileInfoResult,
} from "@/api";
import ReactMarkdown from "react-markdown";
import AITracePanel from "@/components/AITracePanel";
import ThinkingPanel from "@/components/ThinkingPanel";
import { useThinkingPreference } from "@/hooks/useThinkingPreference";

const { TextArea } = Input;
const { Paragraph, Text } = Typography;
const { Dragger } = Upload;

/** 提示信息 */
interface Notice {
  type: "success" | "error";
  text: string;
}

/** 格式化入库时间（ISO → 本地日期时间） */
function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const KnowledgeBasePanel: React.FC = () => {
  // ========== Excel 导入状态 ==========
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [importMode, setImportMode] = useState<"replace" | "append">("replace");
  const [importing, setImporting] = useState(false);
  const [importNotice, setImportNotice] = useState<Notice | null>(null);
  const [importFailed, setImportFailed] = useState<
    { row: number; reason: string }[]
  >([]);

  // ========== 手动单条状态 ==========
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadNotice, setUploadNotice] = useState<Notice | null>(null);

  // ========== 文本解析状态 ==========
  const [parseText, setParseText] = useState("");
  const [useLLM, setUseLLM] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [parsedEntries, setParsedEntries] = useState<KnowledgeEntry[]>([]);
  const [parseNotice, setParseNotice] = useState<Notice | null>(null);
  const [batchMode, setBatchMode] = useState<"replace" | "append">("append");
  const [batching, setBatching] = useState(false);

  // ========== 我的知识状态 ==========
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);

  // ========== 智能问答状态 ==========
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [chunks, setChunks] = useState<RetrievedChunk[]>([]);
  const [answer, setAnswer] = useState("");
  const [askError, setAskError] = useState<string | null>(null);
  const [traceEvents, setTraceEvents] = useState<TraceEvent[]>([]);

  // ========== 深度思考状态 ==========
  /** 本次请求后端是否开启了深度思考（meta 事件下发） */
  const [thinkingEnabled, setThinkingEnabled] = useState(false);
  /** 是否正在思考（检索结束后点亮，思考结果到达后熄灭） */
  const [thinkingActive, setThinkingActive] = useState(false);
  /** 已到达的思考过程（知识库问答通常只有一段） */
  const [reasoningEntries, setReasoningEntries] = useState<ReasoningEntry[]>([]);

  /**
   * 深度思考开关偏好。
   *
   * effective = 全局熔断（配置中心 switch.deep_thinking）∩ 用户本地偏好，
   * 这才是真正下发给后端的值；后端还会再判定一次，并以 meta 事件回传结论。
   */
  const thinking = useThinkingPreference();

  // ========== 上传文件元信息（文件真相源） ==========
  const [fileInfo, setFileInfo] = useState<KnowledgeFileInfoResult | null>(null);
  const hasFile = fileInfo?.hasFile === true;

  /**
   * 加载「我的知识」列表。
   */
  const loadDocuments = useCallback(async () => {
    setLoadingDocs(true);
    setDocError(null);
    const res = await listKnowledgeDocuments();
    if (res.success && res.data) {
      setDocuments(res.data);
    } else {
      setDocError(res.message || "查询知识库失败");
    }
    setLoadingDocs(false);
  }, []);

  /** 加载上传文件元信息（判断显示模板引导还是文件卡片） */
  const loadFileInfo = useCallback(async () => {
    const res = await getKnowledgeFileInfoApi();
    if (res.success && res.data) {
      setFileInfo(res.data);
    }
  }, []);

  useEffect(() => {
    // 首次进入面板时预加载「我的知识」列表与文件元信息。
    //
    // 这里用 async 包裹并 await，而不是直接在 effect 体内调用：
    // loadDocuments 的第一条语句就是 setLoadingDocs(true)，同步调用会引发
    // 级联渲染（react-hooks/set-state-in-effect）；放进 await 之后状态更新
    // 落在微任务里，不再阻塞本次渲染提交。cancelled 用于组件已卸载时跳过写入。
    let cancelled = false;
    void (async () => {
      await loadDocuments();
      if (cancelled) return;
      await loadFileInfo();
    })();

    return () => {
      cancelled = true;
    };
  }, [loadDocuments, loadFileInfo]);

  /** 下载模板（首次引导） */
  const handleDownloadTemplate = async () => {
    const res = await downloadKnowledgeTemplate();
    if (!res.ok) {
      setImportNotice({ type: "error", text: res.message || "下载失败" });
    }
  };

  /** 下载上次文件（文件真相源） */
  const handleDownloadFile = async () => {
    const res = await downloadKnowledgeFile();
    if (!res.ok) {
      setImportNotice({ type: "error", text: res.message || "下载失败" });
    }
  };

  /** 删除保存的文件记录（回到模板引导状态，已入库知识不受影响） */
  const handleDeleteFile = async () => {
    const res = await deleteKnowledgeFileApi();
    if (res.success) {
      setFileInfo({ hasFile: false });
    } else {
      setImportNotice({ type: "error", text: res.message || "删除失败" });
    }
  };

  /** Excel 导入 */
  const handleImport = async () => {
    if (!selectedFile) {
      setImportNotice({ type: "error", text: "请先选择 Excel 文件" });
      return;
    }
    setImporting(true);
    setImportNotice(null);
    setImportFailed([]);

    const res = await importKnowledgeFromFile(selectedFile, importMode);

    if (res.success) {
      const okCount = res.data?.documentCount ?? 0;
      const failed = res.data?.failed ?? [];
      setImportFailed(failed);
      setImportNotice({
        type: "success",
        text: `${
          importMode === "replace" ? "同步替换" : "追加入库"
        }成功：${okCount} 条知识${failed.length ? `，${failed.length} 行校验失败` : ""}`,
      });
      setSelectedFile(null);
      loadDocuments(); // 刷新列表
      loadFileInfo(); // 刷新文件元信息（上传成功会更新真相源文件）
    } else {
      setImportNotice({ type: "error", text: res.message });
    }
    setImporting(false);
  };

  /** 删除文档 */
  const handleDelete = async (id: string) => {
    const res = await deleteKnowledgeDocument(id);
    if (res.success) {
      loadDocuments();
    } else {
      setDocError(res.message || "删除失败");
    }
  };

  /** 手动单条上传 */
  const handleUploadText = async () => {
    if (!title.trim() || !content.trim()) {
      setUploadNotice({ type: "error", text: "请填写文档标题和内容" });
      return;
    }
    setUploading(true);
    setUploadNotice(null);
    const res = await uploadKnowledgeApi(title.trim(), content.trim());
    if (res.success) {
      setUploadNotice({
        type: "success",
        text: `文档已入库，自动切分为 ${res.data?.chunkCount ?? 0} 个片段`,
      });
      setTitle("");
      setContent("");
      loadDocuments();
    } else {
      setUploadNotice({ type: "error", text: res.message });
    }
    setUploading(false);
  };

  /** 文本解析（规则 + 可选 LLM 兜底） */
  const handleParseText = async () => {
    if (!parseText.trim()) {
      setParseNotice({ type: "error", text: "请粘贴要解析的文本" });
      return;
    }
    setParsing(true);
    setParseNotice(null);
    setParsedEntries([]);

    const res = await parseTextToEntriesApi(parseText.trim(), useLLM);

    if (res.success && res.data) {
      setParsedEntries(res.data.entries);
      if (res.data.needLLM) {
        setParseNotice({
          type: "error",
          text: "未识别到结构化条目，可勾选「AI 智能解析」后重试",
        });
      } else {
        setParseNotice({
          type: "success",
          text: `解析出 ${res.data.entries.length} 条知识，确认后入库`,
        });
      }
    } else {
      setParseNotice({ type: "error", text: res.message });
    }
    setParsing(false);
  };

  /** 解析出的条目批量入库 */
  const handleBatchImport = async () => {
    if (parsedEntries.length === 0) return;
    setBatching(true);
    const res = await batchImportEntries(parsedEntries, batchMode);
    if (res.success) {
      setParseNotice({
        type: "success",
        text: `入库成功：${res.data?.documentCount ?? 0} 条知识`,
      });
      setParsedEntries([]);
      setParseText("");
      loadDocuments();
    } else {
      setParseNotice({ type: "error", text: res.message });
    }
    setBatching(false);
  };

  /** 发起知识库问答 */
  const handleAsk = async () => {
    if (!question.trim() || asking) return;
    setAsking(true);
    setAskError(null);
    setChunks([]);
    setAnswer("");
    setTraceEvents([]);
    // 重置思考面板，避免上一轮的内容残留到这一轮
    setThinkingEnabled(false);
    setThinkingActive(false);
    setReasoningEntries([]);

    // 用局部变量而不是 state 记录「后端是否开启思考」：
    // onStart 与 onRetrieve 由同一个 SSE 循环连续触发，此时 React 的 state
    // 还没提交，读 state 会拿到旧值。
    let thinkingOn = false;

    await askKnowledgeStream(question.trim(), {
      onStart: (meta) => {
        thinkingOn = meta?.thinking?.enabled === true;
        setThinkingEnabled(thinkingOn);
      },
      onRetrieve: (retrieved) => {
        setChunks(retrieved);
        // 图结构是 retrieve → generate，检索一结束就意味着模型开始推理，
        // 此刻才点亮「思考中」，避免与「正在检索知识库…」的 loading 语义重叠
        if (thinkingOn) setThinkingActive(true);
      },
      onReasoning: (payload) => {
        // 思考结果到达：停表并累积内容（耗时以后端返回的真实值为准）
        setReasoningEntries((prev) => [...prev, payload]);
        setThinkingActive(false);
      },
      onAnswer: (generated) => {
        // 回答开始产出说明思考阶段已经结束。这里兜底停表，
        // 覆盖「开启了思考但模型没返回思考文本」的退化情况
        setThinkingActive(false);
        setAnswer(generated);
      },
      onTrace: (events) => setTraceEvents(events),
      onDone: (result) => {
        setChunks(result.chunks);
        setAnswer(result.answer);
      },
      onError: (message) => {
        setAskError(message);
        setThinkingActive(false);
      },
    }, {
      // 会话级意图：后端还会叠加全局熔断，最终以后端 meta 回传的结论为准
      thinking: thinking.effective,
    });

    // 兜底停表：正常路径已在上面停过，这里覆盖异常中断的情况
    setThinkingActive(false);
    setAsking(false);
  };

  // ========== 渲染：上传知识 Tab ==========
  const renderUploadTab = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* 文件真相源：无文件 → 模板引导；有文件 → 文件卡片（下载/删除） */}
      <div
        style={{
          border: "0.5px solid var(--color-border-tertiary, #e8e8e8)",
          borderRadius: 8,
          padding: "12px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        {hasFile ? (
          <>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: 8,
              }}
            >
              <Space size={8} wrap>
                <FileTextOutlined style={{ color: "#3b82f6" }} />
                <Text strong style={{ fontSize: 14 }}>
                  {fileInfo?.filename}
                </Text>
                {fileInfo?.updatedAt && (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {formatTime(fileInfo.updatedAt)}
                  </Text>
                )}
              </Space>
              <Space size={4}>
                <Button
                  size="small"
                  icon={<DownloadOutlined />}
                  onClick={handleDownloadFile}
                >
                  下载
                </Button>
                <Popconfirm
                  title="确认删除该文件记录？"
                  description="只删除文件记录，已入库的知识不受影响"
                  okText="删除"
                  cancelText="取消"
                  okButtonProps={{ danger: true }}
                  onConfirm={handleDeleteFile}
                >
                  <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              </Space>
            </div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              新增或修改内容请在该文件基础上编辑后再上传（同步替换）
            </Text>
          </>
        ) : (
          <>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: 8,
              }}
            >
              <Text style={{ fontSize: 13 }}>
                首次使用请先下载模板，填写后上传即可批量入库
              </Text>
              <Button
                size="small"
                icon={<DownloadOutlined />}
                onClick={handleDownloadTemplate}
              >
                下载模板
              </Button>
            </div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              模板列：标题（必填）· 检索词 · 分类 · 内容（必填）
            </Text>
          </>
        )}
      </div>

      {/* Excel 拖拽上传 */}
      <Dragger
        accept=".xlsx,.xls"
        maxCount={1}
        showUploadList={false}
        disabled={importing}
        beforeUpload={(file) => {
          setSelectedFile(file);
          setImportNotice(null);
          return false; // 阻止自动上传，手动触发导入
        }}
      >
        <p style={{ fontSize: 28, marginBottom: 8 }}>
          <InboxOutlined />
        </p>
        <p style={{ fontSize: 14 }}>点击或拖拽 Excel 文件到此处</p>
        <p style={{ fontSize: 12, color: "var(--color-text-tertiary, #888)" }}>
          列：标题（必填）· 检索词 · 分类 · 内容（必填）
        </p>
      </Dragger>

      {/* 已选文件 + 导入模式 */}
      {selectedFile && (
        <Space direction="vertical" style={{ width: "100%" }} size={12}>
          <Space>
            <Tag color="blue" icon={<FileTextOutlined />}>
              {selectedFile.name}
            </Tag>
            <Button size="small" type="text" onClick={() => setSelectedFile(null)}>
              移除
            </Button>
          </Space>

          <Radio.Group
            value={importMode}
            onChange={(e) => setImportMode(e.target.value)}
            disabled={importing}
          >
            <Space direction="vertical" size={4}>
              <Radio value="replace">
                <Text>同步替换（清空旧知识，按文件全量重建）</Text>
              </Radio>
              <Radio value="append">
                <Text>追加合并（只新增文件里的条目，旧的保留）</Text>
              </Radio>
            </Space>
          </Radio.Group>

          <Button
            type="primary"
            icon={<UploadOutlined />}
            loading={importing}
            onClick={handleImport}
          >
            导入到知识库
          </Button>
        </Space>
      )}

      {/* 导入结果 */}
      {importNotice && (
        <Alert type={importNotice.type} showIcon message={importNotice.text} />
      )}

      {/* 校验失败行明细 */}
      {importFailed.length > 0 && (
        <div
          style={{
            background: "var(--color-background-secondary, #fafafa)",
            border: "0.5px solid var(--color-border-tertiary, #e8e8e8)",
            borderRadius: 8,
            padding: "8px 12px",
          }}
        >
          <Text
            type="secondary"
            style={{ fontSize: 13, display: "block", marginBottom: 4 }}
          >
            校验失败的行（请修改后重新上传）：
          </Text>
          {importFailed.map((f) => (
            <Text key={f.row} type="danger" style={{ fontSize: 13, display: "block" }}>
              第 {f.row} 行：{f.reason}
            </Text>
          ))}
        </div>
      )}

      {/* 粘贴文本解析 */}
      <Space orientation="vertical" style={{ width: "100%" }} size={12}>
        <DividerPlain />
        <div>
          <Text strong style={{ fontSize: 14 }}>粘贴文本解析</Text>
          <Text type="secondary" style={{ fontSize: 12, display: "block", marginTop: 2 }}>
            按「# 标题 / 检索词：/ 分类：/ 正文」格式粘贴可自动解析成多条，自由格式可勾选 AI 智能解析
          </Text>
        </div>

        <TextArea
          value={parseText}
          onChange={(e) => setParseText(e.target.value)}
          placeholder={"# React 虚拟 DOM\n检索词：虚拟DOM, diff算法\n分类：前端/React\n虚拟 DOM 是用 JS 对象模拟真实 DOM…\n\n# 小程序分包优化\n检索词：分包, 体积优化\n分类：小程序\n主包控制在 1.5MB 以内…"}
          autoSize={{ minRows: 4, maxRows: 10 }}
        />

        <Space wrap>
          <Checkbox checked={useLLM} onChange={(e) => setUseLLM(e.target.checked)}>
            AI 智能解析（规则解析失败时兜底）
          </Checkbox>
          <Button
            icon={<BulbOutlined />}
            loading={parsing}
            onClick={handleParseText}
            disabled={!parseText.trim()}
          >
            解析
          </Button>
        </Space>

        {parseNotice && <Alert type={parseNotice.type} showIcon message={parseNotice.text} />}

        {/* 解析结果预览 */}
        {parsedEntries.length > 0 && (
          <div>
            <List
              size="small"
              dataSource={parsedEntries}
              renderItem={(entry, index) => (
                <List.Item
                  actions={[
                    <Button
                      key="rm"
                      size="small"
                      type="text"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() =>
                        setParsedEntries((prev) => prev.filter((_, i) => i !== index))
                      }
                    />,
                  ]}
                >
                  <div style={{ width: "100%" }}>
                    <Space size={8} wrap>
                      <Text strong style={{ fontSize: 13 }}>
                        {entry.title}
                      </Text>
                      {entry.category && <Tag color="blue">{entry.category}</Tag>}
                    </Space>
                    {entry.keywords && (
                      <div>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          检索词：{entry.keywords}
                        </Text>
                      </div>
                    )}
                    <Paragraph
                      type="secondary"
                      ellipsis={{ rows: 2, expandable: true, symbol: "展开" }}
                      style={{ marginBottom: 0, fontSize: 12 }}
                    >
                      {entry.content}
                    </Paragraph>
                  </div>
                </List.Item>
              )}
            />
            <Space style={{ marginTop: 8 }} wrap>
              <Radio.Group
                value={batchMode}
                onChange={(e) => setBatchMode(e.target.value)}
                size="small"
              >
                <Radio.Button value="append">追加合并</Radio.Button>
                <Radio.Button value="replace">同步替换</Radio.Button>
              </Radio.Group>
              <Button
                type="primary"
                size="small"
                loading={batching}
                onClick={handleBatchImport}
              >
                入库 {parsedEntries.length} 条
              </Button>
            </Space>
          </div>
        )}
      </Space>

      {/* 手动单条（折叠，保留文本录入） */}
      <Space orientation="vertical" style={{ width: "100%" }} size={12}>
        <DividerPlain />
        <Input
          placeholder="或手动录入单条：文档标题，如「React 面试笔记」"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={100}
          prefix={<FileTextOutlined />}
        />
        <TextArea
          placeholder="文档内容（面试题、JD、学习笔记等）"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          autoSize={{ minRows: 3, maxRows: 8 }}
        />
        <Button
          type="default"
          icon={<UploadOutlined />}
          loading={uploading}
          onClick={handleUploadText}
          disabled={!title.trim() || !content.trim()}
        >
          上传单条文本
        </Button>
      </Space>

      {uploadNotice && (
        <Alert type={uploadNotice.type} showIcon message={uploadNotice.text} />
      )}
    </div>
  );

  // ========== 渲染：我的知识 Tab ==========
  const renderListTab = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Space style={{ justifyContent: "space-between", width: "100%" }}>
        <Text type="secondary" style={{ fontSize: 13 }}>
          共 {documents.length} 条知识
        </Text>
        <Button
          size="small"
          icon={<ReloadOutlined />}
          onClick={loadDocuments}
          loading={loadingDocs}
        >
          刷新
        </Button>
      </Space>

      {docError && <Alert type="error" showIcon message={docError} />}

      {loadingDocs ? (
        <div style={{ textAlign: "center", padding: "24px 0" }}>
          <Spin />
        </div>
      ) : documents.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="还没有知识，去「上传知识」导入吧"
        />
      ) : (
        <List
          dataSource={documents}
          renderItem={(doc) => (
            <List.Item
              actions={[
                <Popconfirm
                  key="del"
                  title="确认删除这条知识？"
                  description="删除后其向量分块将一并清除，无法恢复"
                  okText="删除"
                  cancelText="取消"
                  okButtonProps={{ danger: true }}
                  onConfirm={() => handleDelete(doc.id)}
                >
                  <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                </Popconfirm>,
              ]}
            >
              <List.Item.Meta
                title={
                  <Space size={8} wrap>
                    <Text strong style={{ fontSize: 14 }}>
                      {doc.title}
                    </Text>
                    {doc.category && <Tag color="blue">{doc.category}</Tag>}
                  </Space>
                }
                description={
                  <Space direction="vertical" size={2} style={{ width: "100%" }}>
                    {doc.keywords && (
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        检索词：
                        {doc.keywords
                          .split(/[,，、]/)
                          .filter(Boolean)
                          .slice(0, 6)
                          .map((kw) => (
                            <Tag key={kw} style={{ marginRight: 4, fontSize: 12 }}>
                              {kw}
                            </Tag>
                          ))}
                      </Text>
                    )}
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {doc.chunkCount} 个分块 · {formatTime(doc.createdAt)}
                    </Text>
                  </Space>
                }
              />
            </List.Item>
          )}
        />
      )}
    </div>
  );

  // ========== 渲染：智能问答 Tab ==========
  const renderAskTab = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* 深度思考开关：默认关闭，用户主动开启后答案更细但耗时更长 */}
      <Space size={6} align="center">
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
              ? "开启后模型会先推理再作答：答案更细致，但耗时更长（约 10–30 秒）。推理过程会展示在下方，可展开查看。"
              : "管理员已在系统设置中关闭「深度思考」能力"
          }
        >
          <QuestionCircleOutlined
            style={{ color: "var(--text-secondary, #999)", cursor: "help" }}
          />
        </Tooltip>
        {/* 开关处于关闭状态时给一句轻提示，避免用户以为功能坏了 */}
        {!thinking.available && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            已由管理员关闭
          </Text>
        )}
      </Space>

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

      {chunks.length > 0 && (
        <div>
          <Text type="secondary" style={{ fontSize: 13 }}>
            检索到 {chunks.length} 个相关知识片段：
          </Text>
          <List
            size="small"
            dataSource={chunks}
            renderItem={(chunk, index) => (
              <List.Item key={index} style={{ alignItems: "flex-start", paddingInline: 0 }}>
                <div style={{ width: "100%" }}>
                  <Space size={8} style={{ marginBottom: 4 }} wrap>
                    <Tag color="blue">[{index + 1}] {chunk.documentTitle}</Tag>
                    <Tag color="green">相似度 {(chunk.score * 100).toFixed(1)}%</Tag>
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

      {asking && !answer && chunks.length === 0 && (
        <div style={{ textAlign: "center", padding: "24px 0" }}>
          <Spin tip="正在检索知识库…" />
        </div>
      )}

      {/* 【深度思考】思考过程面板：检索完成后点亮，思考结果到达后可展开全文。
          用 thinkingEnabled 兜底，保证后端未开启思考时不会出现空白思考块。 */}
      {thinkingEnabled && (thinkingActive || reasoningEntries.length > 0) && (
        <ThinkingPanel active={thinkingActive} entries={reasoningEntries} />
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
          {/* 用 Markdown 渲染 AI 回答：LLM 返回的内容带 **加粗**、列表等语法，
              之前按纯文本显示导致星号原样露出，这里交给 react-markdown 解析 */}
          <div className="md-answer">
            <ReactMarkdown>{answer}</ReactMarkdown>
          </div>
        </div>
      )}

      {traceEvents.length > 0 && <AITracePanel events={traceEvents} />}

      {!asking && !answer && chunks.length === 0 && !askError && (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="上传知识后，就可以在这里提问" />
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
          { key: "upload", label: "上传知识", children: renderUploadTab() },
          { key: "list", label: "我的知识", children: renderListTab() },
          { key: "ask", label: "智能问答", children: renderAskTab() },
        ]}
      />
    </Card>
  );
};

/** 手动单条与 Excel 导入之间的分隔线 */
function DividerPlain() {
  return (
    <div
      style={{
        borderTop: "0.5px solid var(--color-border-tertiary, #e8e8e8)",
        margin: "4px 0",
      }}
    />
  );
}

export default KnowledgeBasePanel;
