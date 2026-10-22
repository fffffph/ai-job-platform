"use client";

/**
 * ============================================
 * 菜单管理页（/dashboard/system/menu）
 * ============================================
 *
 * 【职责】
 * 以树形表格维护菜单树（目录/菜单/按钮三级）：
 * - 展示：名称 / 类型 / 权限码 / 路由 / 图标 / 排序 / 状态 / 操作；
 * - 新增子项：在任意层级新增，自动把当前行设为父级；
 * - 编辑：父级 / 名称 / 权限码（不可改） / 路由 / 图标 / 排序 / 显示 / 状态；
 * - 删除：含子节点时后端拒绝并提示先删子节点；
 * - 选择 button 类型时隐藏并清空「路由/图标/显示」。
 *
 * 【权限】
 * 新增加载自 window 单例（hasPermission），按钮级控制显隐；后端接口兜底鉴权。
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Table,
  Button,
  Modal,
  Form,
  Input,
  InputNumber,
  Switch,
  Radio,
  Select,
  TreeSelect,
  Tag,
  Space,
  App,
  Popconfirm,
  Card,
  Empty,
} from "antd";
import {
  PlusOutlined,
  ReloadOutlined,
  EditOutlined,
  DeleteOutlined,
  MenuOutlined,
} from "@ant-design/icons";
import type { TableProps, TreeSelectProps } from "antd";
import {
  getMenuTreeApi,
  createMenuApi,
  updateMenuApi,
  deleteMenuApi,
} from "@/api";
import type { MenuItem, MenuType, CreateMenuParams } from "@/api";
import { loadAppConfig, hasPermission } from "@/lib/app-config";
import { PERMISSIONS, PERMISSION_CODE_PATTERN, PERMISSION_CODE_HINT } from "@/lib/permissions";
import { ICON_NAMES, getMenuIcon } from "@/lib/menu-icons";

/** 扩展 MenuItem 增加 children（树形表格用） */
interface MenuRow extends MenuItem {
  children?: MenuRow[];
}

/** 类型 → 展示（文案 + 颜色） */
const TYPE_META: Record<MenuType, { label: string; color: string }> = {
  catalog: { label: "目录", color: "gold" },
  menu: { label: "菜单", color: "blue" },
  button: { label: "按钮", color: "green" },
};

/**
 * 平铺菜单 → 树形表格数据（按 parentId 组装，递归排序）。
 */
function buildTableTree(items: MenuItem[]): MenuRow[] {
  const map = new Map<string, MenuRow>();
  for (const item of items) map.set(item.id, { ...item });

  const roots: MenuRow[] = [];
  for (const item of items) {
    const node = map.get(item.id)!;
    if (item.parentId && map.has(item.parentId)) {
      const parent = map.get(item.parentId)!;
      parent.children ??= [];
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortRec = (arr: MenuRow[]): void => {
    arr.sort((a, b) => a.sort - b.sort);
    for (const n of arr) if (n.children) sortRec(n.children);
  };
  sortRec(roots);
  return roots;
}

/**
 * 构建「父级菜单」TreeSelect 数据（仅目录/菜单可作为父级，剔除 button）。
 */
function buildParentTree(items: MenuItem[]): TreeSelectProps["treeData"] {
  const eligible = items.filter((i) => i.type !== "button");
  const map = new Map<string, { value: string; title: string; children: unknown[] }>();
  for (const i of eligible) map.set(i.id, { value: i.id, title: i.name, children: [] });

  const roots: unknown[] = [];
  for (const i of eligible) {
    const node = map.get(i.id)!;
    if (i.parentId && map.has(i.parentId)) {
      (map.get(i.parentId)!.children as unknown[]).push(node);
    } else {
      roots.push(node);
    }
  }
  return roots as TreeSelectProps["treeData"];
}

const MenuManagePage: React.FC = () => {
  const { message } = App.useApp();

  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<MenuItem[]>([]);

  // 按钮级权限
  const [canCreate, setCanCreate] = useState(false);
  const [canUpdate, setCanUpdate] = useState(false);
  const [canDelete, setCanDelete] = useState(false);

  // 弹窗状态
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<MenuItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  // 受控：当前选中的类型（控制字段显隐）
  const [formType, setFormType] = useState<MenuType>("menu");

  /**
   * 拉取数据（所有 setState 均在 await 之后）。
   *
   * 【为什么 effect 里要包一层 IIFE + cancelled 标记】
   * React Compiler 的 react-hooks/set-state-in-effect 规则禁止在 effect
   * 体内**直接调用**含 setState 的函数（会引发级联渲染）。包一层异步 IIFE
   * 后 setState 全部落在微任务里，且 cancelled 标记防止组件卸载后 setState。
   * （与 user/page.tsx、role/page.tsx 的写法保持一致。）
   *
   * @param isCancelled - 可选的取消探针，effect 卸载清理时返回 true
   */
  const loadData = useCallback(
    async (isCancelled?: () => boolean) => {
      await loadAppConfig();
      if (isCancelled?.()) return;
      setCanCreate(hasPermission(PERMISSIONS.MENU_CREATE));
      setCanUpdate(hasPermission(PERMISSIONS.MENU_UPDATE));
      setCanDelete(hasPermission(PERMISSIONS.MENU_DELETE));

      const res = await getMenuTreeApi();
      if (isCancelled?.()) return;
      if (res.success && res.data) {
        setItems(res.data);
      } else {
        message.error(res.message || "读取菜单失败");
      }
      setLoading(false);
    },
    [message]
  );

  /** 手动刷新（按钮用）：先亮 loading 再拉数据 */
  const refresh = useCallback(() => {
    setLoading(true);
    void loadData();
  }, [loadData]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await loadData(() => cancelled);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadData]);

  const treeData = useMemo(() => buildTableTree(items), [items]);
  const parentTreeData = useMemo(() => buildParentTree(items), [items]);

  /** 打开「新增」弹窗（parentId 为空 = 顶级） */
  const openCreate = (parentId: string | null = null) => {
    setEditing(null);
    setFormType("menu");
    form.resetFields();
    form.setFieldsValue({
      parentId,
      type: "menu",
      sort: 0,
      visible: true,
      status: "active",
    });
    setModalOpen(true);
  };

  /** 打开「新增子项」弹窗（父级 = 当前行） */
  const openCreateChild = (record: MenuItem) => openCreate(record.id);

  /** 打开「编辑」弹窗 */
  const openEdit = (record: MenuItem) => {
    setEditing(record);
    setFormType(record.type);
    form.setFieldsValue({
      parentId: record.parentId,
      type: record.type,
      code: record.code,
      name: record.name,
      path: record.path,
      icon: record.icon,
      sort: record.sort,
      visible: record.visible,
      status: record.status,
    });
    setModalOpen(true);
  };

  /** 保存（新增 / 编辑） */
  const handleSave = async () => {
    let values: Record<string, unknown>;
    try {
      values = (await form.validateFields()) as Record<string, unknown>;
    } catch {
      return;
    }

    const type = values.type as MenuType;
    const isButton = type === "button";

    const payload: CreateMenuParams = {
      parentId: (values.parentId as string) ?? null,
      type,
      code: String(values.code ?? "").trim(),
      name: String(values.name ?? "").trim(),
      // button 类型忽略并清空 路由/图标/显示
      path: isButton ? null : ((values.path as string) ?? null),
      icon: isButton ? null : ((values.icon as string) ?? null),
      sort: Number(values.sort ?? 0),
      visible: isButton ? true : Boolean(values.visible),
      status: (values.status as "active" | "disabled") ?? "active",
    };

    setSaving(true);
    const res = editing
      ? await updateMenuApi(editing.id, payload)
      : await createMenuApi(payload);
    setSaving(false);

    if (res.success) {
      message.success(editing ? "保存成功" : "新增成功");
      setModalOpen(false);
      setEditing(null);
      await refresh();
    } else {
      message.error(res.message || "操作失败");
    }
  };

  /** 删除 */
  const handleDelete = async (record: MenuItem) => {
    const res = await deleteMenuApi(record.id);
    if (res.success) {
      message.success("删除成功");
      await refresh();
    } else {
      message.error(res.message || "删除失败");
    }
  };

  const columns: TableProps<MenuRow>["columns"] = [
    {
      title: "菜单名称",
      dataIndex: "name",
      key: "name",
      width: 220,
      render: (_v, record) => (
        <Space size={6}>
          {record.type !== "button" ? getMenuIconTag(record.icon) : null}
          <span>{record.name}</span>
        </Space>
      ),
    },
    {
      title: "类型",
      dataIndex: "type",
      key: "type",
      width: 90,
      render: (type: MenuType) => <Tag color={TYPE_META[type].color}>{TYPE_META[type].label}</Tag>,
    },
    {
      title: "权限码",
      dataIndex: "code",
      key: "code",
      width: 190,
      render: (code: string) => <span style={{ fontFamily: "monospace", fontSize: 12 }}>{code}</span>,
    },
    {
      title: "路由",
      dataIndex: "path",
      key: "path",
      width: 200,
      render: (path: string | null) =>
        path ? <span style={{ fontFamily: "monospace", fontSize: 12 }}>{path}</span> : "—",
    },
    {
      title: "图标",
      dataIndex: "icon",
      key: "icon",
      width: 90,
      render: (icon: string | null) => (icon ? <span style={{ fontFamily: "monospace", fontSize: 12 }}>{icon}</span> : "—"),
    },
    { title: "排序", dataIndex: "sort", key: "sort", width: 70 },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 90,
      render: (status: string) =>
        status === "active" ? <Tag color="green">启用</Tag> : <Tag color="red">停用</Tag>,
    },
    {
      title: "操作",
      key: "action",
      width: 220,
      render: (_v, record) => (
        <Space size={0} wrap>
          {canCreate && record.type !== "button" && (
            <Button type="link" size="small" icon={<PlusOutlined />} onClick={() => openCreateChild(record)}>
              子项
            </Button>
          )}
          {canUpdate && (
            <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(record)}>
              编辑
            </Button>
          )}
          {canDelete && (
            <Popconfirm
              title="确认删除该菜单？"
              description="若仍存在子菜单，将无法删除"
              onConfirm={() => handleDelete(record)}
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
            >
              <Button type="link" size="small" danger icon={<DeleteOutlined />}>
                删除
              </Button>
            </Popconfirm>
          )}
          {!canCreate && !canUpdate && !canDelete && <span style={{ color: "#999" }}>—</span>}
        </Space>
      ),
    },
  ];

  const isButton = formType === "button";

  return (
    <div style={{ padding: "24px 32px", maxWidth: 1200, margin: "0 auto" }}>
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
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 4px", display: "flex", alignItems: "center", gap: 8 }}>
            <MenuOutlined style={{ color: "#3b82f6" }} />
            菜单管理
          </h1>
          <p style={{ margin: 0, color: "var(--muted-foreground, #888)", fontSize: 13 }}>
            维护菜单树（目录/菜单/按钮），控制侧边栏展示与按钮级权限
          </p>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={refresh} loading={loading}>
            刷新
          </Button>
          {canCreate && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => openCreate(null)}>
              新增菜单
            </Button>
          )}
        </Space>
      </div>

      <Card style={{ borderRadius: 12 }}>
        <Table<MenuRow>
          rowKey="id"
          dataSource={treeData}
          columns={columns}
          loading={loading}
          pagination={false}
          size="middle"
          scroll={{ x: 1080 }}
          locale={{ emptyText: <Empty description="暂无菜单，点击右上角新增" /> }}
        />
      </Card>

      {/* 新增 / 编辑弹窗 */}
      <Modal
        title={editing ? "编辑菜单" : "新增菜单"}
        open={modalOpen}
        onCancel={() => {
          setModalOpen(false);
          setEditing(null);
        }}
        onOk={handleSave}
        confirmLoading={saving}
        okText="保存"
        cancelText="取消"
        width={640}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item name="parentId" label="父级菜单">
            <TreeSelect
              treeData={parentTreeData}
              allowClear
              placeholder="不选则为顶级（根）"
              treeDefaultExpandAll
            />
          </Form.Item>

          <Form.Item
            name="type"
            label="菜单类型"
            rules={[{ required: true }]}
            /**
             * 选中「按钮」类型时给出说明文案。
             *
             * 背景：按钮不是界面元素，而是「权限点（权限码）」——
             * 它不进侧边栏、不自动生成任何界面按钮，必须由代码显式引用
             * （前端 hasPermission 控制显隐 / 后端 requirePermission 保护接口）
             * 才会产生效果。此处提示用于避免「新增了按钮却看不到」的困惑。
             */
            extra={
              isButton ? (
                <span>
                  按钮是<strong>权限点（权限码）</strong>：不会显示在侧边栏，也不会自动生成界面按钮；
                  需在代码中用{" "}
                  <span style={{ fontFamily: "monospace" }}>hasPermission()</span>
                  {" "}控制按钮显隐、
                  <span style={{ fontFamily: "monospace" }}>requirePermission()</span>
                  {" "}保护接口后才会生效。
                </span>
              ) : undefined
            }
          >
            <Radio.Group
              onChange={(e) => {
                const nextType = e.target.value as MenuType;
                setFormType(nextType);
                // 切换为按钮类型：清空「路由/图标/显示」
                if (nextType === "button") {
                  form.setFieldsValue({ path: null, icon: null, visible: true });
                }
              }}
              options={[
                { label: "目录", value: "catalog" },
                { label: "菜单", value: "menu" },
                { label: "按钮", value: "button" },
              ]}
              optionType="button"
            />
          </Form.Item>

          <Form.Item
            name="name"
            label="菜单名称"
            rules={[{ required: true, message: "请输入菜单名称" }]}
          >
            <Input placeholder="如「角色管理」" />
          </Form.Item>

          <Form.Item
            name="code"
            label="权限码"
            rules={[
              { required: true, message: "请输入权限码" },
              { max: 64, message: "权限码长度不能超过 64 个字符" },
              {
                validator: (_r, value: string) =>
                  !value || PERMISSION_CODE_PATTERN.test(value)
                    ? Promise.resolve()
                    : Promise.reject(new Error("格式不正确")),
              },
            ]}
            extra={
              editing
                ? "权限码创建后不可修改"
                : PERMISSION_CODE_HINT
            }
          >
            <Input
              placeholder="如 system:role:grant"
              style={{ fontFamily: "monospace" }}
              disabled={!!editing}
            />
          </Form.Item>

          {!isButton && (
            <>
              <Form.Item
                name="path"
                label="路由路径"
                rules={[
                  {
                    validator: (_r, value: string) =>
                      formType === "menu" && !value
                        ? Promise.reject(new Error("菜单类型必须填写路由路径"))
                        : Promise.resolve(),
                  },
                ]}
              >
                <Input placeholder="如 /dashboard/system/role" style={{ fontFamily: "monospace" }} />
              </Form.Item>

              <Form.Item name="icon" label="图标">
                <Select
                  allowClear
                  placeholder="选择图标（可选）"
                  options={ICON_NAMES.map((n) => ({ value: n, label: n }))}
                />
              </Form.Item>

              <Form.Item name="visible" label="显示在菜单" valuePropName="checked">
                <Switch checkedChildren="是" unCheckedChildren="否" />
              </Form.Item>
            </>
          )}

          <Form.Item name="sort" label="排序（同级升序）" rules={[{ required: true }]}>
            <InputNumber style={{ width: "100%" }} min={0} placeholder="如 10" />
          </Form.Item>

          <Form.Item name="status" label="状态">
            <Radio.Group
              options={[
                { label: "启用", value: "active" },
                { label: "停用", value: "disabled" },
              ]}
              optionType="button"
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

/**
 * 渲染菜单图标（仅用于表格展示，小尺寸）。
 */
function getMenuIconTag(icon: string | null): React.ReactNode {
  const IconComp = getMenuIcon(icon) as React.ComponentType<{ style?: React.CSSProperties }>;
  return React.createElement(IconComp, { style: { color: "#3b82f6" } });
}

export default MenuManagePage;
