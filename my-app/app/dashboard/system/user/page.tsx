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
  Form,
  Radio,
  Alert,
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
  EditOutlined,
  DeleteOutlined,
} from "@ant-design/icons";
import type { TableProps } from "antd";
import {
  getUserListApi,
  assignUserRolesApi,
  setUserStatusApi,
  getRoleListApi,
  getUserProfile,
  resetUserPasswordApi,
  deleteUserApi,
} from "@/api";
import type { AdminUserItem, RoleItem, ResetPasswordParams } from "@/api";
import { loadAppConfig, hasPermission, getConfigValue } from "@/lib/app-config";
import { PERMISSIONS } from "@/lib/permissions";
import { validatePassword, passwordRuleHint } from "@/lib/password";
import { useIsMobile } from "@/hooks/use-mobile";
import CreateUserModal from "./CreateUserModal";
import EditUserModal from "./EditUserModal";

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

  // 是否移动端（<768px）：决定表格「操作列」是否取消固定
  const isMobile = useIsMobile();

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
  const [canUpdate, setCanUpdate] = useState(false);
  const [canResetPassword, setCanResetPassword] = useState(false);
  const [canDelete, setCanDelete] = useState(false);
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

  // 编辑用户弹窗（B-P1）
  const [editOpen, setEditOpen] = useState(false);
  const [editUser, setEditUser] = useState<AdminUserItem | null>(null);

  // 重置密码弹窗（B-P1）
  const [resetOpen, setResetOpen] = useState(false);
  const [resetUser, setResetUser] = useState<AdminUserItem | null>(null);
  const [resetSubmitting, setResetSubmitting] = useState(false);
  const [resetForm] = Form.useForm<{
    passwordMode: "default" | "custom";
    password?: string;
  }>();

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
      setCanUpdate(hasPermission(PERMISSIONS.USER_UPDATE));
      setCanResetPassword(hasPermission(PERMISSIONS.USER_RESET_PASSWORD));
      setCanDelete(hasPermission(PERMISSIONS.USER_DELETE));
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

  /** 打开「编辑用户」弹窗 */
  const openEdit = (record: AdminUserItem) => {
    setEditUser(record);
    setEditOpen(true);
  };

  /** 编辑保存成功回调 */
  const handleSaved = async () => {
    setEditOpen(false);
    setEditUser(null);
    await loadUsers();
  };

  /** 打开「重置密码」弹窗 */
  const openReset = (record: AdminUserItem) => {
    setResetUser(record);
    resetForm.resetFields();
    resetForm.setFieldsValue({ passwordMode: "default" });
    setResetOpen(true);
  };

  /** 提交重置密码 */
  const handleResetPassword = async () => {
    if (!resetUser) return;

    let values: { passwordMode: "default" | "custom"; password?: string };
    try {
      values = await resetForm.validateFields();
    } catch {
      return;
    }

    const payload: ResetPasswordParams = {
      passwordMode: values.passwordMode,
      password: values.passwordMode === "custom" ? values.password : undefined,
    };

    setResetSubmitting(true);
    const res = await resetUserPasswordApi(resetUser.id, payload);
    setResetSubmitting(false);

    if (res.success) {
      message.success("密码已重置，该账号已被强制下次登录改密");
      setResetOpen(false);
      setResetUser(null);
      await loadUsers();
    } else {
      message.error(res.message || "重置密码失败");
    }
  };

  /** 删除用户（软删除） */
  const handleDelete = async (record: AdminUserItem) => {
    const res = await deleteUserApi(record.id);
    if (res.success) {
      message.success("用户已删除");
      await loadUsers();
    } else {
      message.error(res.message || "删除用户失败");
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
      /**
       * 移动端适配：
       * - 桌面端：宽 360 + fixed right，操作按钮始终可见；
       * - 移动端：取消固定（fixed right 的悬浮层会盖住左侧内容，
       *   且 360px 列宽几乎占满 440px 视口，左侧内容没法看），
       *   并把列宽收窄到 200，让按钮多换行、减少横向滚动距离。
       */
      width: isMobile ? 200 : 360,
      fixed: isMobile ? undefined : "right",
      render: (_v, record) => {
        const isSelf = record.id === selfId;
        return (
          <Space size={0} wrap>
            {canUpdate && (
              <Button
                type="link"
                size="small"
                icon={<EditOutlined />}
                onClick={() => openEdit(record)}
              >
                编辑
              </Button>
            )}
            <Button
              type="link"
              size="small"
              icon={<UserSwitchOutlined />}
              disabled={!canGrant}
              onClick={() => openAssign(record)}
            >
              分配角色
            </Button>
            {canResetPassword && (
              <Button
                type="link"
                size="small"
                icon={<KeyOutlined />}
                onClick={() => openReset(record)}
              >
                重置密码
              </Button>
            )}
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
            {canDelete && (
              <Tooltip title={isSelf ? "不能删除当前登录账号" : ""}>
                <Popconfirm
                  title="确认删除该用户？"
                  description="删除后该账号将无法登录（软删除，可从回收站恢复，回收站功能后续开放）"
                  onConfirm={() => handleDelete(record)}
                  okText="删除"
                  cancelText="取消"
                  okButtonProps={{ danger: true }}
                  disabled={isSelf}
                >
                  <Button
                    type="link"
                    size="small"
                    danger
                    disabled={isSelf}
                    icon={<DeleteOutlined />}
                  >
                    删除
                  </Button>
                </Popconfirm>
              </Tooltip>
            )}
          </Space>
        );
      },
    },
  ];

  return (
    /**
     * 移动端适配：
     * - 水平内边距用 clamp()：窄屏（手机）收窄到 16px，≥400px 视口线性放大到 32px，
     *   避免固定 32px 内边距在 440px 视口下只剩 376px 内容宽度；
     * - 其余（垂直 24px / 最大宽 1200 / 居中）与原版保持一致。
     */
    <div style={{ padding: "24px clamp(16px, 4vw, 32px)", maxWidth: 1200, margin: "0 auto" }}>
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
        {/*
          * 工具栏（搜索 / 刷新 / 新增）
          * 移动端适配要点：
          * 1. Space 加 wrap —— 默认 Space 不换行，三个控件加起来约 460px，
          *    在 440px 视口下会把整页撑出横向滚动条（角色管理页只有两个按钮
          *    所以没暴露这个问题）；
          * 2. 搜索框 width 260 + maxWidth "100%" —— 宽屏保持 260px，
          *    窄屏收缩到容器宽度，和按钮一起换行堆叠。
          */}
        <Space wrap style={{ justifyContent: "flex-end" }}>
          <Input.Search
            allowClear
            placeholder="搜索邮箱、用户名、手机号或昵称"
            style={{ width: 260, maxWidth: "100%" }}
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
          scroll={{ x: 1380 }}
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

      {/* 编辑用户弹窗（B-P1） */}
      <EditUserModal
        open={editOpen}
        record={editUser}
        onClose={() => {
          setEditOpen(false);
          setEditUser(null);
        }}
        onSaved={handleSaved}
      />

      {/* 重置密码弹窗（B-P1） */}
      <Modal
        title={resetUser ? `重置密码 · ${getUserDisplayName(resetUser)}` : "重置密码"}
        open={resetOpen}
        onCancel={() => {
          setResetOpen(false);
          setResetUser(null);
        }}
        onOk={handleResetPassword}
        confirmLoading={resetSubmitting}
        okText="重置"
        cancelText="取消"
        width={520}
        destroyOnHidden
      >
        <Form
          form={resetForm}
          layout="vertical"
          style={{ marginTop: 8 }}
        >
          <Form.Item name="passwordMode" label="密码来源">
            <Radio.Group>
              <Radio.Button value="default">
                <KeyOutlined /> 使用系统默认密码
              </Radio.Button>
              <Radio.Button value="custom">自定义新密码</Radio.Button>
            </Radio.Group>
          </Form.Item>

          {Form.useWatch("passwordMode", resetForm) === "custom" ? (
            <Form.Item
              name="password"
              label="新密码"
              rules={[
                {
                  validator: (_rule, value: string) => {
                    const err = validatePassword(
                      value ?? "",
                      getConfigValue<number>("auth.password.min_length", 8)
                    );
                    return err
                      ? Promise.reject(new Error(err))
                      : Promise.resolve();
                  },
                },
              ]}
              extra={passwordRuleHint(
                getConfigValue<number>("auth.password.min_length", 8)
              )}
            >
              <Input.Password
                allowClear
                placeholder="请输入新密码"
                autoComplete="new-password"
              />
            </Form.Item>
          ) : (
            <Alert
              type="warning"
              showIcon
              title="将使用系统配置的默认密码"
              description="密码来自「系统设置 → 登录与账号 → 新增用户默认密码」。重置后该账号会被强制下次登录改密。"
            />
          )}
        </Form>
      </Modal>
    </div>
  );
};

export default UserManagePage;
