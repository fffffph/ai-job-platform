"use client";

/**
 * ============================================
 * 角色管理页（/dashboard/system/role）
 * ============================================
 *
 * 【职责】
 * - 角色列表：名称 / 标识码 / 描述 / 用户数 / 权限 / 操作；
 * - 新增 / 编辑（code 不可改） / 删除（内置角色或仍有关联用户拒绝）；
 * - 「分配权限」弹窗：以可勾选树展示全量菜单（含 button），保存调用绑定接口；
 * - admin 行：权限列显示「全部权限（不可编辑）」，编辑/删除/分配按钮置灰 + Tooltip；
 * - 内置角色（isSystem，含 user）：删除按钮置灰。
 *
 * 【权限】
 * 写操作按钮由 hasPermission 控制显隐；后端接口兜底鉴权。
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Table,
  Button,
  Modal,
  Form,
  Input,
  Tag,
  Space,
  App,
  Popconfirm,
  Tooltip,
  Card,
  Empty,
  Tree,
  Alert,
} from "antd";
import {
  PlusOutlined,
  ReloadOutlined,
  EditOutlined,
  DeleteOutlined,
  SafetyOutlined,
  TeamOutlined,
  LockOutlined,
} from "@ant-design/icons";
import type { TableProps } from "antd";
import {
  getRoleListApi,
  createRoleApi,
  updateRoleApi,
  deleteRoleApi,
  getRoleMenusApi,
  setRoleMenusApi,
  getMenuTreeApi,
} from "@/api";
import type { RoleItem, MenuItem } from "@/api";
import { loadAppConfig, hasPermission } from "@/lib/app-config";
import { PERMISSIONS } from "@/lib/permissions";

/** Antd Tree 的节点结构 */
interface TreeItem {
  title: string;
  key: string;
  children?: TreeItem[];
}

/**
 * 平铺菜单 → Antd Tree 数据（含 button，按 parentId 组装，递归排序）。
 */
function buildMenuTreeData(items: MenuItem[]): TreeItem[] {
  const map = new Map<string, TreeItem>();
  for (const i of items) {
    map.set(i.id, {
      title: i.type === "button" ? `${i.name}（${i.code}）` : i.name,
      key: i.id,
      children: [],
    });
  }
  const roots: TreeItem[] = [];
  for (const i of items) {
    const node = map.get(i.id)!;
    if (i.parentId && map.has(i.parentId)) {
      map.get(i.parentId)!.children!.push(node);
    } else {
      roots.push(node);
    }
  }
  const sortRec = (arr: TreeItem[], ids: Map<string, number>): void => {
    arr.sort((a, b) => (ids.get(a.key) ?? 0) - (ids.get(b.key) ?? 0));
    for (const n of arr) if (n.children && n.children.length > 0) sortRec(n.children, ids);
  };
  const sortMap = new Map(items.map((i) => [i.id, i.sort]));
  sortRec(roots, sortMap);

  // 裁掉空 children
  const prune = (arr: TreeItem[]): void => {
    for (const n of arr) {
      if (n.children && n.children.length === 0) delete n.children;
      else if (n.children) prune(n.children);
    }
  };
  prune(roots);
  return roots;
}

const RoleManagePage: React.FC = () => {
  const { message } = App.useApp();

  const [loading, setLoading] = useState(true);
  const [roles, setRoles] = useState<RoleItem[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);

  // 按钮级权限
  const [canCreate, setCanCreate] = useState(false);
  const [canUpdate, setCanUpdate] = useState(false);
  const [canDelete, setCanDelete] = useState(false);
  const [canGrant, setCanGrant] = useState(false);

  // 新增/编辑弹窗
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<RoleItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  // 分配权限弹窗
  const [grantOpen, setGrantOpen] = useState(false);
  const [granting, setGranting] = useState(false);
  const [grantRole, setGrantRole] = useState<RoleItem | null>(null);
  const [checkedKeys, setCheckedKeys] = useState<React.Key[]>([]);
  const [halfCheckedKeys, setHalfCheckedKeys] = useState<React.Key[]>([]);

  /** 加载角色 + 菜单 + 权限 */
  const refresh = useCallback(async () => {
    setLoading(true);
    await loadAppConfig();
    setCanCreate(hasPermission(PERMISSIONS.ROLE_CREATE));
    setCanUpdate(hasPermission(PERMISSIONS.ROLE_UPDATE));
    setCanDelete(hasPermission(PERMISSIONS.ROLE_DELETE));
    setCanGrant(hasPermission(PERMISSIONS.ROLE_GRANT));

    const [roleRes, menuRes] = await Promise.all([getRoleListApi(), getMenuTreeApi()]);
    if (roleRes.success && roleRes.data) {
      setRoles(roleRes.data);
    } else {
      message.error(roleRes.message || "读取角色列表失败");
    }
    if (menuRes.success && menuRes.data) {
      setMenuItems(menuRes.data);
    }
    setLoading(false);
  }, [message]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const treeData = useMemo(() => buildMenuTreeData(menuItems), [menuItems]);

  /** 打开「新增角色」 */
  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setEditOpen(true);
  };

  /** 打开「编辑角色」 */
  const openEdit = (record: RoleItem) => {
    setEditing(record);
    form.setFieldsValue({
      code: record.code,
      name: record.name,
      description: record.description ?? "",
    });
    setEditOpen(true);
  };

  /** 保存角色（新增 / 编辑） */
  const handleSaveRole = async () => {
    let values: Record<string, unknown>;
    try {
      values = (await form.validateFields()) as Record<string, unknown>;
    } catch {
      return;
    }

    setSaving(true);
    const res = editing
      ? await updateRoleApi(editing.id, {
          name: String(values.name ?? "").trim(),
          description: String(values.description ?? ""),
        })
      : await createRoleApi({
          code: String(values.code ?? "").trim(),
          name: String(values.name ?? "").trim(),
          description: String(values.description ?? ""),
        });
    setSaving(false);

    if (res.success) {
      message.success(editing ? "保存成功" : "新增成功");
      setEditOpen(false);
      setEditing(null);
      await refresh();
    } else {
      message.error(res.message || "操作失败");
    }
  };

  /** 删除角色 */
  const handleDelete = async (record: RoleItem) => {
    const res = await deleteRoleApi(record.id);
    if (res.success) {
      message.success("删除成功");
      await refresh();
    } else {
      message.error(res.message || "删除失败");
    }
  };

  /** 打开「分配权限」弹窗 */
  const openGrant = async (record: RoleItem) => {
    setGrantRole(record);
    const res = await getRoleMenusApi(record.id);
    if (res.success && res.data) {
      // 仅设置叶子节点为选中，父节点由 Tree 自动推导 halfChecked
      const leafIds = new Set(
        menuItems.filter((m) => !menuItems.some((c) => c.parentId === m.id)).map((m) => m.id)
      );
      const menuIds = res.data.menuIds;
      setCheckedKeys(menuIds.filter((id) => leafIds.has(id)));
      setHalfCheckedKeys(menuIds.filter((id) => !leafIds.has(id)));
      setGrantOpen(true);
    } else {
      message.error(res.message || "读取角色权限失败");
    }
  };

  /** 保存角色权限 */
  const handleSaveGrant = async () => {
    if (!grantRole) return;
    // 保存「选中 + 半选」全部 id，保证父级目录也被持久化
    const menuIds = Array.from(
      new Set([...checkedKeys, ...halfCheckedKeys].map((k) => String(k)))
    );

    setGranting(true);
    const res = await setRoleMenusApi(grantRole.id, { menuIds });
    setGranting(false);

    if (res.success) {
      message.success("权限已保存，将在用户重新登录后生效");
      setGrantOpen(false);
      setGrantRole(null);
      await refresh();
    } else {
      message.error(res.message || "保存权限失败");
    }
  };

  const columns: TableProps<RoleItem>["columns"] = [
    {
      title: "角色名称",
      dataIndex: "name",
      key: "name",
      width: 160,
      render: (name: string, record) => (
        <Space size={6}>
          {record.isSystem ? <LockOutlined style={{ color: "#faad14" }} /> : null}
          <span style={{ fontWeight: 500 }}>{name}</span>
        </Space>
      ),
    },
    {
      title: "标识码",
      dataIndex: "code",
      key: "code",
      width: 150,
      render: (code: string) => <span style={{ fontFamily: "monospace", fontSize: 12 }}>{code}</span>,
    },
    { title: "描述", dataIndex: "description", key: "description", ellipsis: true },
    { title: "用户数", dataIndex: "userCount", key: "userCount", width: 90 },
    {
      title: "权限",
      key: "menuCount",
      width: 170,
      render: (_v, record) =>
        record.menuCount === null ? (
          <Tag color="gold">全部权限（不可编辑）</Tag>
        ) : (
          <Tag color="blue">{record.menuCount} 项权限</Tag>
        ),
    },
    {
      title: "操作",
      key: "action",
      width: 240,
      render: (_v, record) => {
        // admin（menuCount 为 null）不可编辑/删除/分配
        const isAdminRole = record.code === "admin";
        const grantDisabled = isAdminRole || !canGrant;
        const editDisabled = isAdminRole || !canUpdate;
        // 内置角色（含 user）不可删除
        const deleteDisabled = record.isSystem || !canDelete;

        return (
          <Space size={0} wrap>
            <Tooltip title={isAdminRole ? "系统内置角色，权限不可修改" : ""}>
              <Button
                type="link"
                size="small"
                icon={<SafetyOutlined />}
                disabled={grantDisabled}
                onClick={() => openGrant(record)}
              >
                分配权限
              </Button>
            </Tooltip>
            <Tooltip title={isAdminRole ? "系统内置角色，不可修改" : ""}>
              <Button
                type="link"
                size="small"
                icon={<EditOutlined />}
                disabled={editDisabled}
                onClick={() => openEdit(record)}
              >
                编辑
              </Button>
            </Tooltip>
            <Tooltip title={record.isSystem ? "系统内置角色，不可删除" : ""}>
              <Popconfirm
                title="确认删除该角色？"
                description={record.userCount > 0 ? `该角色下仍有 ${record.userCount} 个用户` : "删除后不可恢复"}
                onConfirm={() => handleDelete(record)}
                okText="删除"
                cancelText="取消"
                okButtonProps={{ danger: true }}
                disabled={deleteDisabled}
              >
                <Button type="link" size="small" danger icon={<DeleteOutlined />} disabled={deleteDisabled}>
                  删除
                </Button>
              </Popconfirm>
            </Tooltip>
          </Space>
        );
      },
    },
  ];

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
            <TeamOutlined style={{ color: "#3b82f6" }} />
            角色管理
          </h1>
          <p style={{ margin: 0, color: "var(--muted-foreground, #888)", fontSize: 13 }}>
            维护角色并为其分配菜单/按钮权限
          </p>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={refresh} loading={loading}>
            刷新
          </Button>
          {canCreate && (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新增角色
            </Button>
          )}
        </Space>
      </div>

      <Card style={{ borderRadius: 12 }}>
        <Table<RoleItem>
          rowKey="id"
          dataSource={roles}
          columns={columns}
          loading={loading}
          pagination={false}
          size="middle"
          scroll={{ x: 1000 }}
          locale={{ emptyText: <Empty description="暂无角色，点击右上角新增" /> }}
        />
      </Card>

      {/* 新增 / 编辑角色弹窗 */}
      <Modal
        title={editing ? "编辑角色" : "新增角色"}
        open={editOpen}
        onCancel={() => {
          setEditOpen(false);
          setEditing(null);
        }}
        onOk={handleSaveRole}
        confirmLoading={saving}
        okText="保存"
        cancelText="取消"
        width={560}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="code"
            label="角色标识码"
            rules={[
              { required: true, message: "请输入角色标识码" },
              { max: 64, message: "角色标识码长度不能超过 64 个字符" },
            ]}
            extra={editing ? "角色标识码创建后不可修改" : "全小写，如 auditor"}
          >
            <Input placeholder="如 auditor" style={{ fontFamily: "monospace" }} disabled={!!editing} />
          </Form.Item>
          <Form.Item name="name" label="角色名称" rules={[{ required: true, message: "请输入角色名称" }]}>
            <Input placeholder="如「审核员」" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input placeholder="简要说明该角色的用途" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 分配权限弹窗 */}
      <Modal
        title={grantRole ? `分配权限 · ${grantRole.name}` : "分配权限"}
        open={grantOpen}
        onCancel={() => {
          setGrantOpen(false);
          setGrantRole(null);
        }}
        onOk={handleSaveGrant}
        confirmLoading={granting}
        okText="保存"
        cancelText="取消"
        width={560}
        destroyOnClose
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="勾选后该角色可访问对应菜单与按钮，保存后将在用户重新登录后生效"
        />
        <Tree
          checkable
          defaultExpandAll
          treeData={treeData}
          checkedKeys={checkedKeys}
          onCheck={(checked, info) => {
            setCheckedKeys(Array.isArray(checked) ? checked : checked.checked);
            setHalfCheckedKeys(info.halfCheckedKeys ?? []);
          }}
        />
      </Modal>
    </div>
  );
};

export default RoleManagePage;
