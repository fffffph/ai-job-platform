"use client";

/**
 * ============================================
 * SettingsPage —— 系统设置（配置中心）
 * ============================================
 *
 * 【职责】
 * 以「表格 + 弹窗」形式集中管理全系统的可配置项（Prompt / 模型参数 /
 * 检索参数 / 职位发现 / 功能开关），schema 驱动渲染，无需改前端代码。
 *
 * 【权限】
 * - 所有登录用户可「只读」查看（配置读开放）；
 * - 仅 admin 角色可「编辑 / 保存 / 恢复默认」（后端 requireRole 兜底，
 *   前端也按角色隐藏编辑入口，避免无意义的 403 交互）。
 *
 * 【数据流】
 * 1. 进入页面 → 优先读 window 单例（登录后已拉取一次），否则 getConfigsApi()；
 * 2. 点击「编辑」→ 弹窗按类型渲染控件（数字/开关/文本/多行/JSON）；
 * 3. 保存 → saveConfigOneApi → 刷新本地 + 同步 window 单例；
 * 4. 恢复默认 → resetConfigOneApi / resetAllConfigsApi。
 */

import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Card,
  Tabs,
  Table,
  Button,
  Modal,
  Form,
  Input,
  InputNumber,
  Switch,
  Tag,
  Space,
  App,
  Typography,
  Popconfirm,
  Select,
  Tooltip,
  Alert,
  Empty,
  Spin,
} from "antd";
import {
  ReloadOutlined,
  SettingOutlined,
  EditOutlined,
  RollbackOutlined,
  LockOutlined,
  DeleteOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import { motion } from "framer-motion";
import {
  getConfigsApi,
  createConfigApi,
  saveConfigOneApi,
  resetConfigOneApi,
  resetAllConfigsApi,
} from "@/api";
import type { EffectiveConfigItem, ConfigType, ConfigGroup } from "@/api";
import { getAppConfig, loadAppConfig, isAdmin } from "@/lib/app-config";

const { Text } = Typography;
const { TextArea } = Input;

// ============================================================
// 常量映射（与后端 config/schema.ts 对齐）
// ============================================================

/** 分组中文名（Tab 标题用） */
const GROUP_LABELS: Record<ConfigGroup, string> = {
  prompt: "Prompt 文案",
  llm: "模型参数",
  rag: "知识库检索",
  jobs: "职位发现",
  switch: "功能开关",
  custom: "自定义",
};

/** 分组固定展示顺序 */
const GROUP_ORDER: ConfigGroup[] = ["prompt", "llm", "rag", "jobs", "switch", "custom"];

/** 类型 → 展示元信息（标签 / 颜色） */
const TYPE_META: Record<ConfigType, { label: string; color: string }> = {
  string: { label: "文本", color: "blue" },
  textarea: { label: "多行文本", color: "geekblue" },
  number: { label: "数字", color: "purple" },
  boolean: { label: "开关", color: "green" },
  json: { label: "JSON", color: "orange" },
  "json-array": { label: "JSON 数组", color: "volcano" },
  file: { label: "文件", color: "default" },
};

/** 配置 key 命名正则（与后端 config/schema.ts 对齐，全小写、点分、见名知意） */
const CONFIG_KEY_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;

/** 新增配置时可选的类型下拉（file 类型当前无实际用途，暂不开放） */
const TYPE_OPTIONS: Array<{ value: ConfigType; label: string }> = [
  { value: "string", label: "文本（单行）" },
  { value: "textarea", label: "多行文本" },
  { value: "number", label: "数字" },
  { value: "boolean", label: "开关" },
  { value: "json", label: "JSON 对象" },
  { value: "json-array", label: "JSON 数组" },
];

// ============================================================
// 值格式化 / 转换辅助
// ============================================================

/** 把配置值格式化为表格可读文本 */
function formatValue(item: EffectiveConfigItem): string {
  switch (item.type) {
    case "boolean":
      return item.value ? "开启" : "关闭";
    case "json":
    case "json-array":
      return JSON.stringify(item.value);
    default:
      return String(item.value ?? "");
  }
}

/** 把配置值转成表单可编辑的初始值（json 类转成 JSON 字符串） */
function toFormValue(item: EffectiveConfigItem): unknown {
  if (item.type === "json" || item.type === "json-array") {
    return JSON.stringify(item.value ?? null, null, 2);
  }
  return item.value;
}

/**
 * 把表单值转回后端可接受的配置值。
 * - number → InputNumber 已是 number，直接返回；
 * - json / json-array → 校验并 JSON.parse；
 * - 其余原样返回。
 *
 * @throws JSON 解析失败时抛出中文错误，供表单校验捕获
 */
function fromFormValue(type: ConfigType, formValue: unknown): unknown {
  if (type === "json" || type === "json-array") {
    if (typeof formValue !== "string" || !formValue.trim()) {
      throw new Error("请输入 JSON 内容");
    }
    try {
      const parsed = JSON.parse(formValue);
      if (type === "json" && Array.isArray(parsed)) {
        throw new Error("该配置项要求 JSON 对象（{}），不是数组");
      }
      if (type === "json-array" && !Array.isArray(parsed)) {
        throw new Error("该配置项要求 JSON 数组（[]），不是对象");
      }
      return parsed;
    } catch (error) {
      if ((error as Error).message.startsWith("该配置项")) {
        throw error;
      }
      throw new Error("JSON 格式错误，请检查后重试");
    }
  }
  return formValue;
}

const SettingsPage: React.FC = () => {
  const { message } = App.useApp();

  // ========== 数据状态 ==========
  const [loading, setLoading] = useState(true);
  const [configs, setConfigs] = useState<EffectiveConfigItem[]>([]);
  const [admin, setAdmin] = useState(false);

  // ========== 编辑弹窗状态 ==========
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<EffectiveConfigItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  // ========== 新增配置弹窗状态 ==========
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createType, setCreateType] = useState<ConfigType>("string");
  const [createForm] = Form.useForm();

  /**
   * 刷新配置列表 + 同步 window 单例。
   *
   * 优先从 window 单例取（登录后已拉取），否则走接口；
   * force 用于保存/恢复后强制重新拉取。
   */
  const refreshConfigs = useCallback(async (force = false) => {
    setLoading(true);
    const cached = force ? null : getAppConfig();
    let items: EffectiveConfigItem[] = [];

    if (cached && cached.configs.length > 0) {
      items = cached.configs;
    } else {
      const res = await getConfigsApi();
      if (res.success && res.data) {
        items = res.data;
      } else {
        message.error(res.message || "读取系统配置失败");
      }
    }

    setConfigs(items);

    // 同步角色（从 window 单例或重新加载）
    const appState = await loadAppConfig(force);
    setAdmin(isAdmin(appState?.roles));

    // 若 window 单例里 configs 过期，写回最新
    if (force && typeof window !== "undefined") {
      const st = window.__APP_CONFIG__;
      if (st) st.configs = items;
    }

    setLoading(false);
  }, [message]);

  useEffect(() => {
    refreshConfigs(false);
  }, [refreshConfigs]);

  // ========== 按分组组织数据 ==========
  const grouped = useMemo(() => {
    const map: Record<string, EffectiveConfigItem[]> = {};
    for (const g of GROUP_ORDER) map[g] = [];
    for (const item of configs) {
      if (map[item.group]) map[item.group].push(item);
    }
    return map;
  }, [configs]);

  // ========== 打开编辑弹窗 ==========
  const openEdit = (item: EffectiveConfigItem) => {
    setEditing(item);
    setEditOpen(true);
    // 回填表单（json 类转成字符串）
    form.setFieldsValue({
      value: toFormValue(item),
      enabled: item.enabled,
    });
  };

  // ========== 保存配置 ==========
  const handleSave = async () => {
    if (!editing) return;

    let value: unknown;
    try {
      const formValue = form.getFieldValue("value");
      value = fromFormValue(editing.type, formValue);
    } catch (error) {
      message.error((error as Error).message);
      return;
    }

    const enabled = form.getFieldValue("enabled") as boolean;

    setSaving(true);
    const res = await saveConfigOneApi(editing.key, value, enabled);
    if (res.success) {
      message.success("配置已保存，即时生效");
      setEditOpen(false);
      setEditing(null);
      // 保存后强制刷新，确保表格与 AI 侧读到一致的新值
      await refreshConfigs(true);
    } else {
      message.error(res.message || "保存失败");
    }
    setSaving(false);
  };

  // ========== 恢复单条默认 ==========
  const handleResetOne = async (item: EffectiveConfigItem) => {
    const res = await resetConfigOneApi(item.key);
    if (res.success) {
      message.success("已恢复默认值");
      await refreshConfigs(true);
    } else {
      message.error(res.message || "恢复默认失败");
    }
  };

  // ========== 恢复全部默认 ==========
  const handleResetAll = async () => {
    const res = await resetAllConfigsApi();
    if (res.success) {
      message.success("已恢复全部默认值");
      await refreshConfigs(true);
    } else {
      message.error(res.message || "恢复全部默认失败");
    }
  };

  // ========== 打开新增配置弹窗 ==========
  const openCreate = () => {
    createForm.resetFields();
    setCreateType("string");
    createForm.setFieldsValue({ type: "string", enabled: true });
    setCreateOpen(true);
  };

  // ========== 新增动态配置 ==========
  const handleCreate = async () => {
    // 先触发表单校验（label 必填等），失败则 antd 自动标红并中断
    let values: Record<string, unknown>;
    try {
      values = (await createForm.validateFields()) as Record<string, unknown>;
    } catch {
      return;
    }

    const key = String(values.key ?? "").trim();

    // 前置校验 1：key 命名格式（见名知意：全小写、点分）
    if (!CONFIG_KEY_PATTERN.test(key)) {
      message.error("key 不合法：请用全小写、点分命名（如 feature.my_flag）");
      return;
    }

    // 前置校验 2：key 唯一性（注册表项 + 动态项均不得重复）
    if (configs.some((c) => c.key === key)) {
      message.error(`key「${key}」已存在，不能重复新增`);
      return;
    }

    // 按当前选中类型转换值（json 类做 JSON.parse 校验）
    let value: unknown;
    try {
      value = fromFormValue(createType, values.value);
    } catch (error) {
      message.error((error as Error).message);
      return;
    }

    setCreating(true);
    const res = await createConfigApi({
      key,
      type: createType,
      value,
      label: String(values.label ?? "").trim() || undefined,
      description: String(values.description ?? "").trim() || undefined,
      enabled: (values.enabled as boolean) ?? true,
    });

    if (res.success) {
      message.success("新增成功，即时生效");
      setCreateOpen(false);
      await refreshConfigs(true);
    } else {
      message.error(res.message || "新增失败");
    }
    setCreating(false);
  };

  // ========== 表格列定义 ==========
  const columns = [
    {
      title: "配置项",
      key: "label",
      width: 220,
      render: (_: unknown, item: EffectiveConfigItem) => (
        <div>
          <div style={{ fontWeight: 500 }}>{item.label}</div>
          <Text type="secondary" style={{ fontSize: 12, fontFamily: "monospace" }}>
            {item.key}
          </Text>
        </div>
      ),
    },
    {
      title: "类型",
      key: "type",
      width: 100,
      render: (_: unknown, item: EffectiveConfigItem) => {
        const meta = TYPE_META[item.type];
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    {
      title: "当前值",
      key: "value",
      ellipsis: true,
      render: (_: unknown, item: EffectiveConfigItem) => (
        <Tooltip title={formatValue(item)} placement="topLeft">
          <span
            style={{
              display: "inline-block",
              maxWidth: 320,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              verticalAlign: "bottom",
            }}
          >
            {formatValue(item)}
          </span>
        </Tooltip>
      ),
    },
    {
      title: "状态",
      key: "status",
      width: 140,
      render: (_: unknown, item: EffectiveConfigItem) => (
        <Space size={4} wrap>
          {item.overridden ? (
            <Tag color="orange">已覆盖</Tag>
          ) : (
            <Tag color="default">默认</Tag>
          )}
          {!item.enabled && <Tag color="red">已停用</Tag>}
        </Space>
      ),
    },
    {
      title: "操作",
      key: "action",
      width: 160,
      render: (_: unknown, item: EffectiveConfigItem) =>
        admin ? (
          <Space size={4}>
            <Button
              type="link"
              size="small"
              icon={<EditOutlined />}
              onClick={() => openEdit(item)}
            >
              编辑
            </Button>
            {item.overridden && (
              <Popconfirm
                title="恢复默认值？"
                description="将删除该配置项的覆盖值"
                onConfirm={() => handleResetOne(item)}
                okText="恢复"
                cancelText="取消"
              >
                <Button type="link" size="small" danger icon={<RollbackOutlined />}>
                  恢复
                </Button>
              </Popconfirm>
            )}
          </Space>
        ) : (
          <Tooltip title="仅管理员可编辑">
            <LockOutlined style={{ color: "var(--muted-foreground, #888)" }} />
          </Tooltip>
        ),
    },
  ];

  /** 渲染单个分组的表格 */
  const renderTable = (group: ConfigGroup) => {
    const rows = grouped[group] ?? [];
    return (
      <Table
        rowKey="key"
        dataSource={rows}
        columns={columns}
        pagination={false}
        size="middle"
        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该分组暂无配置项" /> }}
        scroll={{ x: 760 }}
      />
    );
  };

  // ========== 值控件：按类型渲染（编辑弹窗 / 新增弹窗共用） ==========
  const renderValueEditor = (
    type: ConfigType,
    meta?: {
      min?: number;
      max?: number;
      enum?: Array<{ value: string; label: string }>;
      jsonSchema?: string;
    }
  ) => {
    switch (type) {
      case "boolean":
        return (
          <Form.Item name="value" label="值" valuePropName="checked">
            <Switch checkedChildren="开启" unCheckedChildren="关闭" />
          </Form.Item>
        );
      case "number":
        return (
          <Form.Item name="value" label="值">
            <InputNumber style={{ width: "100%" }} min={meta?.min} max={meta?.max} />
          </Form.Item>
        );
      case "string":
        if (meta?.enum && meta.enum.length > 0) {
          return (
            <Form.Item name="value" label="值">
              <Select
                options={meta.enum.map((e) => ({ value: e.value, label: e.label }))}
              />
            </Form.Item>
          );
        }
        return (
          <Form.Item name="value" label="值">
            <Input placeholder="请输入" />
          </Form.Item>
        );
      case "textarea":
        return (
          <Form.Item name="value" label="值">
            <TextArea rows={8} placeholder="请输入" />
          </Form.Item>
        );
      case "json":
      case "json-array":
        return (
          <Form.Item
            name="value"
            label="值（JSON）"
            extra={meta?.jsonSchema || "请输入合法 JSON"}
          >
            <TextArea
              rows={8}
              style={{ fontFamily: "monospace", fontSize: 12 }}
              placeholder={type === "json" ? '{\n  "key": "value"\n}' : '[\n  "item"\n]'}
            />
          </Form.Item>
        );
      default:
        return (
          <Form.Item name="value" label="值">
            <Input placeholder="请输入" />
          </Form.Item>
        );
    }
  };

  // ========== 渲染 ==========
  return (
    <div style={{ padding: "24px 32px", maxWidth: 1200, margin: "0 auto" }}>
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.4 }}
      >
        {/* 页头 */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 16,
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div>
            <h1
              style={{
                fontSize: 24,
                fontWeight: 700,
                margin: "0 0 4px",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <SettingOutlined style={{ color: "#3b82f6" }} />
              系统设置
            </h1>
            <Text type="secondary" style={{ fontSize: 13 }}>
              集中管理 Prompt 文案、模型参数、检索参数与功能开关，保存后即时生效
            </Text>
          </div>
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => refreshConfigs(true)} loading={loading}>
              刷新
            </Button>
            {admin && (
              <>
                <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                  新增配置
                </Button>
                <Popconfirm
                  title="恢复全部默认值？"
                  description="将清空所有覆盖值，恢复代码内置默认"
                  onConfirm={handleResetAll}
                  okText="全部恢复"
                  cancelText="取消"
                  okButtonProps={{ danger: true }}
                >
                  <Button danger icon={<DeleteOutlined />}>
                    全部恢复默认
                  </Button>
                </Popconfirm>
              </>
            )}
          </Space>
        </div>

        {/* 权限提示 */}
        {!admin && !loading && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="当前为只读模式"
            description="你以普通用户身份查看系统配置，如需修改请联系管理员。"
          />
        )}

        {/* 分组表格 */}
        {loading && configs.length === 0 ? (
          <div style={{ display: "flex", justifyContent: "center", padding: "60px 0" }}>
            <Spin size="large" />
          </div>
        ) : (
          <Card style={{ borderRadius: 12 }} styles={{ body: { padding: "8px 16px 16px" } }}>
            <Tabs
              defaultActiveKey="prompt"
              items={GROUP_ORDER.map((g) => ({
                key: g,
                label: GROUP_LABELS[g],
                children: renderTable(g),
              }))}
            />
          </Card>
        )}
      </motion.div>

      {/* 编辑弹窗 */}
      <Modal
        title={
          editing
            ? `编辑配置 · ${editing.label}`
            : "编辑配置"
        }
        open={editOpen}
        onCancel={() => {
          setEditOpen(false);
          setEditing(null);
        }}
        onOk={handleSave}
        confirmLoading={saving}
        okText="保存"
        cancelText="取消"
        width={640}
        destroyOnClose
      >
        {editing && (
          <>
            <div style={{ marginBottom: 16 }}>
              <Text type="secondary" style={{ fontSize: 13 }}>
                {editing.description}
              </Text>
              <div style={{ marginTop: 4 }}>
                <Text type="secondary" style={{ fontSize: 12, fontFamily: "monospace" }}>
                  {editing.key}
                </Text>
              </div>
            </div>
            <Form form={form} layout="vertical">
              {renderValueEditor(editing.type, {
                min: editing.min,
                max: editing.max,
                enum: editing.enum,
                jsonSchema: editing.jsonSchema,
              })}
              <Form.Item
                name="enabled"
                label="启用此配置项"
                valuePropName="checked"
                extra="关闭后该配置项的覆盖值临时失效，读取时回退到默认值（保留覆盖值，可随时重新启用）"
              >
                <Switch checkedChildren="启用" unCheckedChildren="停用" />
              </Form.Item>
            </Form>
          </>
        )}
      </Modal>

      {/* 新增配置弹窗（动态配置，key 全局唯一） */}
      <Modal
        title="新增配置"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={handleCreate}
        confirmLoading={creating}
        okText="创建"
        cancelText="取消"
        width={640}
        destroyOnClose
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="新增一个自定义配置项"
          description="key 需全局唯一、见名知意（全小写、点分，如 feature.my_flag）。新增后可在代码里用 appConfigGetValueByKey('key', 默认值) 读取。"
        />
        <Form form={createForm} layout="vertical">
          <Form.Item
            name="key"
            label="配置键 key"
            rules={[
              { required: true, message: "请输入 key" },
              {
                pattern: CONFIG_KEY_PATTERN,
                message: "仅限小写字母/数字/下划线，段间用点分隔，如 feature.my_flag",
              },
            ]}
            extra="命名建议：分组.语义名，见名知意，如 switch.hybrid_search"
          >
            <Input placeholder="如 feature.my_flag" style={{ fontFamily: "monospace" }} />
          </Form.Item>

          <Form.Item
            name="label"
            label="中文名"
            rules={[{ required: true, message: "请输入中文名" }]}
          >
            <Input placeholder="如「我的功能开关」" />
          </Form.Item>

          <Form.Item name="description" label="说明（可选）">
            <Input placeholder="简要说明该配置项的用途" />
          </Form.Item>

          <Form.Item label="值类型">
            <Select
              value={createType}
              onChange={(v: ConfigType) => {
                setCreateType(v);
                // 切换类型清空已填值，避免类型不匹配
                createForm.setFieldValue("value", undefined);
              }}
              options={TYPE_OPTIONS}
              style={{ width: "100%" }}
            />
          </Form.Item>

          {renderValueEditor(createType)}

          <Form.Item
            name="enabled"
            label="启用此配置项"
            valuePropName="checked"
            initialValue={true}
          >
            <Switch checkedChildren="启用" unCheckedChildren="停用" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default SettingsPage;
