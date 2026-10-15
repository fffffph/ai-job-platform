"use client";

/**
 * ============================================
 * 用户管理页（/dashboard/system/user）
 * ============================================
 *
 * 【职责】
 * - 用户列表：登录标识（邮箱/手机号/用户名）/ 昵称 / 角色(Tag) / 状态(Tag) /
 *   最后登录 / 注册时间 / 操作；
 * - 新增用户：跳转 B-P0-8 的 CreateUserModal（权限 system:user:create）；
 * - 分配角色：多选角色，保存调用接口；
 * - 停用/启用：二次确认；不允许停用当前登录的自己（按钮置灰 + Tooltip）；
 * - 搜索（邮箱/用户名/手机号/昵称）+ 分页；空态/加载态/错误态齐全。
 *
 * 【权限】
 * 写操作按钮由 hasPermission 控制显隐；后端接口兜底鉴权。
 *   - system:user:create  → 「新增用户」按钮
 *   - system:user:grant   → 「分配角色」按钮 + 弹窗内角色多选
 *   - system:user:disable → 「停用/启用」按钮
 *
 * 【本次改造要点（B-P0-8）】
 * 1. 原「邮箱」列升级为「登录标识」列 —— 统一账号模型下，邮箱只是三种标识
 *    之一，且可为空，只用邮箱做展示会漏掉纯用户名/纯手机号账号。
 * 2. 新增「最后登录」列：管理员排查「某人到底有没有登过」时最常用。
 * 3. 新增用户入口。
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  Table,
  Button,
  Modal,
  Tag,
  Space,
  App,
  Popconfirm,
  Tooltip,
  Card,
  Empty,
  Select,
  Input,
  Avatar,
} from "antd";
import {
  ReloadOutlined,
  UserSwitchOutlined,
  StopOutlined,
  CheckCircleOutlined,
  UserOutlined,
  PlusOutlined,
  MailOutlined,
  MobileOutlined,
  KeyOutlined,
} from "@ant-design/icons";
import type { TableProps } from "antd";
import {
  getUserListApi,
  assignUserRolesApi,
  setUserStatusApi,
  getRoleListApi,
  getUserProfile,
} from "@/api";
import type { AdminUserItem, RoleItem } from "@/api";
import { loadAppConfig, hasPermission } from "@/lib/app-config";
import { PERMISSIONS } from "@/lib/permissions";
import CreateUserModal from "./CreateUserModal";

const PAGE_SIZE = 10;

/**
 * 取用户的「主展示名」——用于弹窗标题、日志等单行文本场景。
 *
 * 统一账号模型下 email 可能为 null，直接拼接会出现 "null" 字样，
 * 因此按 邮箱 → 用户名 → 手机号 → 昵称 → id 的优先级降级。
 */
function getUserDisplayName(record: AdminUserItem): string {
  return (
    record.email ||
    record.username ||
    record.phone ||
    record.name ||
    record.id.slice(0, 8)
  );
}

/**
 * 渲染「登录标识」单元格。
 *
 * 三种标识可能同时存在，逐个渲染成带图标的 Tag，用 lineHeight 让多行时
 * 不挤在一起；一个都没有时（理论上不该出现）显示「—」并标红提示。
 */
const IdentifierCell: React.FC<{ record: AdminUserItem }> = ({ record }) => {
  const items: React.ReactNode[] = [];

  if (record.email) {
    items.push(
      <Tag key="email" icon={<MailOutlined />} color="blue">
        {record.email}
      </Tag>
    );
  }
  if (record.username) {
    items.push(
      <Tag key="username" icon={<UserOutlined />} color="geekblue">
        {record.username}
      </Tag>
    );
  }
  if (record.phone) {
    items.push(
      <Tag key="phone" icon={<MobileOutlined />} color="cyan">
        {record.phone}
      </Tag>
    );
  }

  if (items.length === 0) {
    return <Tag color="red">无登录标识</Tag>;
  }

  return (
    <Space size={[4, 4]} wrap>
      {items}
    </Space>
  );
};

const UserManagePage: React.FC = () => {
  const { message } = App.useApp();

  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<AdminUserItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [roles, setRoles] = useState<RoleItem[]>([]);

  // 当前登录用户 id（用于禁止停用自己）
  const [selfId, setSelfId] = useState<string>("");

  // 按钮级权限
  const [canCreate, setCanCreate] = useState(false);
  const [canGrant, setCanGrant] = useState(false);
  const [canDisable, setCanDisable] = useState(false);
  /**
   * 是否有基础配置权限（system:config）。
   *
   * 只用于一件事：决定「新增用户」弹窗里要不要把系统默认密码的**明文**展示
   * 给操作者（配置项 auth.user.default_password 是明文存储的）。
   * 没有配置权限的运营同学只看到「密码来自系统配置」的提示文案，看不到值。
   */
  const [canReadConfig, setCanReadConfig] = useState(false);

  // 新增用户弹窗
  const [createOpen, setCreateOpen] = useState(false);

  // 分配角色弹窗
  const [assignOpen, setAssignOpen] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [assignUser, setAssignUser] = useState<AdminUserItem | null>(null);
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);

  /** 加载用户列表（分页 + 关键字） */
  const loadUsers = useCallback(
    async (targetPage = page, kw = keyword) => {
      setLoading(true);
      const res = await getUserListApi({ keyword: kw || undefined, page: targetPage, pageSize: PAGE_SIZE });
      if (res.success && res.data) {
        setUsers(res.data.items);
        setTotal(res.data.total);
        setPage(res.data.page);
      } else {
        message.error(res.message || "读取用户列表失败");
      }
      setLoading(false);
    },
    [page, keyword, message]
  );

  /** 首次进入：加载权限 + 角色 + 当前用户 + 列表 */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await loadAppConfig();
      if (cancelled) return;
      setCanCreate(hasPermission(PERMISSIONS.USER_CREATE));
      setCanGrant(hasPermission(PERMISSIONS.USER_GRANT));
      setCanDisable(hasPermission(PERMISSIONS.USER_DISABLE));
      setCanReadConfig(hasPermission(PERMISSIONS.SYSTEM_CONFIG));

      const [roleRes, profileRes] = await Promise.all([getRoleListApi(), getUserProfile()]);
      if (cancelled) return;
      if (roleRes.success && roleRes.data) setRoles(roleRes.data);
      if (profileRes.success && profileRes.data) setSelfId(profileRes.data.id);

      await loadUsers(1, "");
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * 新增用户成功回调。
   *
   * 回到第 1 页并清空关键字 —— 新账号按创建时间倒序一般排在首页，
   * 但若当前带着搜索词，新账号可能不匹配而「看起来没创建成功」。
   */
  const handleCreated = async () => {
    setCreateOpen(false);
    setKeyword("");
    await loadUsers(1, "");
  };

  /** 打开「分配角色」弹窗（回填当前角色） */
  const openAssign = (record: AdminUserItem) => {
    setAssignUser(record);
    setSelectedRoleIds(record.roles.map((r) => r.id));
    setAssignOpen(true);
  };

  /** 保存用户角色 */
  const handleSaveAssign = async () => {
    if (!assignUser) return;
    setAssigning(true);
    const res = await assignUserRolesApi(assignUser.id, { roleIds: selectedRoleIds });
    setAssigning(false);

    if (res.success) {
      message.success("已保存，将在该用户重新登录后生效");
      setAssignOpen(false);
      setAssignUser(null);
      await loadUsers();
    } else {
      message.error(res.message || "分配角色失败");
    }
  };

  /** 切换用户状态 */
  const handleToggleStatus = async (record: AdminUserItem) => {
    const nextStatus = record.status === "active" ? "disabled" : "active";
    const res = await setUserStatusApi(record.id, { status: nextStatus });
    if (res.success) {
      message.success(nextStatus === "disabled" ? "已停用该账号" : "已启用该账号");
      await loadUsers();
    } else {
      message.error(res.message || "设置账号状态失败");
    }
  };

  const columns: TableProps<AdminUserItem>["columns"] = [
    {
      title: "登录标识",
      dataIndex: "email",
      key: "identifier",
      width: 300,
      render: (_v, record) => (
        <Space size={8} align="start">
          <Avatar size="small" icon={<UserOutlined />} />
          <IdentifierCell record={record} />
        </Space>
      ),
    },
    {
      title: "昵称",
      dataIndex: "name",
      key: "name",
      width: 120,
      render: (name: string | null, record) => (
        <Space size={4}>
          <span>{name || "—"}</span>
          {record.mustChangePassword && (
            <Tooltip title="该账号尚未完成首次登录改密，当前使用的是管理员设置的初始密码">
              <KeyOutlined style={{ color: "#faad14" }} />
            </Tooltip>
          )}
        </Space>
      ),
    },
    {
      title: "角色",
      dataIndex: "roles",
      key: "roles",
      render: (userRoles: AdminUserItem["roles"]) => (
        <Space size={4} wrap>
          {userRoles.length > 0 ? (
            userRoles.map((r) => (
              <Tag color="blue" key={r.id}>
                {r.name}
              </Tag>
            ))
          ) : (
            <Tag>未分配</Tag>
          )}
        </Space>
      ),
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 100,
      render: (status: string) =>
        status === "active" ? <Tag color="green">正常</Tag> : <Tag color="red">已停用</Tag>,
    },
    {
      title: "最后登录",
      dataIndex: "lastLoginAt",
      key: "lastLoginAt",
      width: 180,
      render: (lastLoginAt: string | null) =>
        lastLoginAt ? (
          new Date(lastLoginAt).toLocaleString("zh-CN")
        ) : (
          <span style={{ color: "var(--muted-foreground, #888)" }}>从未登录</span>
        ),
    },
    {
      title: "注册时间",
      dataIndex: "createdAt",
      key: "createdAt",
      width: 180,
      render: (createdAt: string) => new Date(createdAt).toLocaleString("zh-CN"),
    },
    {
      title: "操作",
      key: "action",
      width: 220,
      fixed: "right",
      render: (_v, record) => {
        const isSelf = record.id === selfId;
        return (
          <Space size={0} wrap>
            <Button
              type="link"
              size="small"
              icon={<UserSwitchOutlined />}
              disabled={!canGrant}
              onClick={() => openAssign(record)}
            >
              分配角色
            </Button>
            <Tooltip title={isSelf ? "不能停用当前登录账号" : ""}>
              <Popconfirm
                title={record.status === "active" ? "确认停用该账号？" : "确认启用该账号？"}
                description={record.status === "active" ? "停用后该用户将无法登录" : "启用后该用户可正常登录"}
                onConfirm={() => handleToggleStatus(record)}
                okText="确认"
                cancelText="取消"
                okButtonProps={{ danger: record.status === "active" }}
                disabled={isSelf || !canDisable}
              >
                <Button
                  type="link"
                  size="small"
                  danger={record.status === "active"}
                  disabled={isSelf || !canDisable}
                  icon={record.status === "active" ? <StopOutlined /> : <CheckCircleOutlined />}
                >
                  {record.status === "active" ? "停用" : "启用"}
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
            <UserOutlined style={{ color: "#3b82f6" }} />
            用户管理
          </h1>
          <p style={{ margin: 0, color: "var(--muted-foreground, #888)", fontSize: 13 }}>
            新增用户、分配角色、停用/启用账号
          </p>
        </div>
        <Space>
          <Input.Search
            allowClear
            placeholder="搜索邮箱、用户名、手机号或昵称"
            style={{ width: 260 }}
            onSearch={(value) => {
              setKeyword(value);
              loadUsers(1, value);
            }}
          />
          <Button icon={<ReloadOutlined />} onClick={() => loadUsers(page, keyword)} loading={loading}>
            刷新
          </Button>
          {canCreate && (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setCreateOpen(true)}
            >
              新增用户
            </Button>
          )}
        </Space>
      </div>

      <Card style={{ borderRadius: 12 }}>
        <Table<AdminUserItem>
          rowKey="id"
          dataSource={users}
          columns={columns}
          loading={loading}
          size="middle"
          scroll={{ x: 1240 }}
          locale={{ emptyText: <Empty description="暂无用户" /> }}
          pagination={{
            current: page,
            pageSize: PAGE_SIZE,
            total,
            showSizeChanger: false,
            showTotal: (t) => `共 ${t} 条`,
            onChange: (p) => loadUsers(p, keyword),
          }}
        />
      </Card>

      {/* 新增用户弹窗（B-P0-8） */}
      <CreateUserModal
        open={createOpen}
        roles={roles}
        canGrantRole={canGrant}
        canReadConfig={canReadConfig}
        onClose={() => setCreateOpen(false)}
        onCreated={handleCreated}
      />

      {/* 分配角色弹窗 */}
      <Modal
        title={assignUser ? `分配角色 · ${getUserDisplayName(assignUser)}` : "分配角色"}
        open={assignOpen}
        onCancel={() => {
          setAssignOpen(false);
          setAssignUser(null);
        }}
        onOk={handleSaveAssign}
        confirmLoading={assigning}
        okText="保存"
        cancelText="取消"
        width={520}
        destroyOnHidden
      >
        <div style={{ marginBottom: 16, color: "var(--muted-foreground, #888)", fontSize: 13 }}>
          为该用户选择一个或多个角色，保存后将在其重新登录后生效。
        </div>
        <Select
          mode="multiple"
          style={{ width: "100%" }}
          placeholder="请选择角色"
          value={selectedRoleIds}
          onChange={(vals) => setSelectedRoleIds(vals)}
          options={roles.map((r) => ({ value: r.id, label: `${r.name}（${r.code}）` }))}
          optionFilterProp="label"
        />
      </Modal>
    </div>
  );
};

export default UserManagePage;
