"use client";

/**
 * ============================================
 * 用户管理页（/dashboard/system/user）
 * ============================================
 *
 * 【职责】
 * - 用户列表：邮箱 / 昵称 / 角色(Tag) / 状态(Tag) / 注册时间 / 操作；
 * - 分配角色：多选角色，保存调用接口；
 * - 停用/启用：二次确认；不允许停用当前登录的自己（按钮置灰 + Tooltip）；
 * - 搜索（邮箱/昵称）+ 分页（P1-8）；空态/加载态/错误态齐全。
 *
 * 【权限】
 * 写操作按钮由 hasPermission 控制显隐；后端接口兜底鉴权。
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

const PAGE_SIZE = 10;

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
  const [canGrant, setCanGrant] = useState(false);
  const [canDisable, setCanDisable] = useState(false);

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
      setCanGrant(hasPermission(PERMISSIONS.USER_GRANT));
      setCanDisable(hasPermission(PERMISSIONS.USER_DISABLE));

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
      title: "邮箱",
      dataIndex: "email",
      key: "email",
      width: 240,
      render: (email: string) => (
        <Space size={8}>
          <Avatar size="small" icon={<UserOutlined />} />
          <span>{email}</span>
        </Space>
      ),
    },
    {
      title: "昵称",
      dataIndex: "name",
      key: "name",
      width: 140,
      render: (name: string | null) => name || "—",
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
      width: 110,
      render: (status: string) =>
        status === "active" ? <Tag color="green">正常</Tag> : <Tag color="red">已停用</Tag>,
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
            为用户分配角色、停用/启用账号
          </p>
        </div>
        <Space>
          <Input.Search
            allowClear
            placeholder="搜索邮箱或昵称"
            style={{ width: 240 }}
            onSearch={(value) => {
              setKeyword(value);
              loadUsers(1, value);
            }}
          />
          <Button icon={<ReloadOutlined />} onClick={() => loadUsers(page, keyword)} loading={loading}>
            刷新
          </Button>
        </Space>
      </div>

      <Card style={{ borderRadius: 12 }}>
        <Table<AdminUserItem>
          rowKey="id"
          dataSource={users}
          columns={columns}
          loading={loading}
          size="middle"
          scroll={{ x: 1080 }}
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

      {/* 分配角色弹窗 */}
      <Modal
        title={assignUser ? `分配角色 · ${assignUser.email}` : "分配角色"}
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
        destroyOnClose
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
        />
      </Modal>
    </div>
  );
};

export default UserManagePage;
