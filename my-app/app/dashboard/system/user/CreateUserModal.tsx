"use client";

/**
 * ============================================
 * 新增用户弹窗（CreateUserModal）
 * ============================================
 *
 * 【对应任务】B-P0-8
 *
 * 【职责】
 * 管理员在「用户管理」页点「+ 新增用户」后弹出的表单，一次性创建账号：
 *   1. 登录标识：邮箱 / 手机号 / 用户名（三选一，至少填一个，均可选填）；
 *   2. 基本信息：昵称、管理员备注；
 *   3. 初始密码：使用系统默认密码 OR 管理员自行设置；
 *   4. 角色：多选（无选择时由后端绑定默认 user 角色）；
 *   5. 账号状态：启用 / 停用；
 *   6. 是否首次登录强制改密。
 *
 * 【设计决策来源】（用户已拍板的 6 条）
 * - 第 2 条：系统配置项 `auth.user.default_password` 内置一个复杂密码并在
 *   配置页展示可改；新增用户时**可选默认密码或自行写入密码** —— 本弹窗
 *   的「初始密码」单选就是这个决策的直接落地。
 * - 第 5 条：暂时不做批量导入 —— 所以这里只有「单个新增」表单。
 *
 * 【两个关键前端保护】
 * 1. 即时唯一性校验：输入框失焦/停止输入 500ms 后调
 *    `GET /api/user/check-identity` 提前告知「该邮箱已被占用」，
 *    避免填完整张表才被后端 409 打回。接口异常时**不阻塞提交**，
 *    由后端唯一索引兜底（前端校验只是体验优化，不是安全边界）。
 * 2. 「至少一个登录标识」：后端要求三字段至少有一个，这里在提交前
 *    先做一次整表校验，用 message 明确指出缺失项，而不是等后端报错。
 *
 * 【为什么不用 destroyOnHidden 而是手动 resetFields】
 * 弹窗关闭即销毁会连带卸载 Form，导致 useForm 实例与表单元素断连
 * （antd 会打印 "Instance created by `useForm` is not connected" 警告）。
 * 改为「常驻挂载 + open 时 resetFields + 回填配置默认值」，行为更可预测。
 */

import React, { useEffect, useState } from "react";
import {
  Modal,
  Form,
  Input,
  Radio,
  Select,
  Switch,
  Alert,
  Divider,
  Typography,
  Space,
  Tag,
  App,
} from "antd";
import type { FormRule } from "antd";
import {
  MailOutlined,
  MobileOutlined,
  UserOutlined,
  KeyOutlined,
} from "@ant-design/icons";

import { createUserApi, checkIdentityApi } from "@/api";
import type {
  CreateUserParams,
  CreateUserResult,
  IdentifierField,
  RoleItem,
  UserStatus,
} from "@/api";
import { getConfigValue } from "@/lib/app-config";
import {
  IDENTIFIER_LABELS,
  USERNAME_HINT,
  EMAIL_PATTERN,
  validateUsername,
  validatePhone,
} from "@/lib/identifier";
import { validatePassword, passwordRuleHint } from "@/lib/password";

const { Text, Paragraph } = Typography;

/** 表单值类型（与表单项 name 一一对应） */
interface CreateUserFormValues {
  email?: string;
  phone?: string;
  username?: string;
  name?: string;
  remark?: string;
  passwordMode: "default" | "custom";
  password?: string;
  roleIds?: string[];
  status: UserStatus;
  mustChangePassword: boolean;
}

export interface CreateUserModalProps {
  /** 是否可见（由父组件控制） */
  open: boolean;
  /** 可分配的角色列表（父组件已加载） */
  roles: RoleItem[];
  /**
   * 是否有「分配角色」权限（父页面的 canGrant 状态）。
   *
   * 【为什么由父组件传入而不是本组件自己 hasPermission】
   * 后端 `POST /api/user` 只要求 `system:user:create`，但「分配角色」这一动作
   * 在职责上属于 `system:user:grant`。若操作者只有 create 没有 grant，
   * 前端就不该让他挑角色（否则等于用 create 接口实现了提权），
   * 此时隐藏角色多选、不传 roleIds，改由后端绑定默认 user 角色。
   *
   * 权限来自 window 单例（外部可变状态），本组件的挂载时机早于
   * `loadAppConfig()` 完成，若自行判断会读到未加载的 false；父页面已经
   * 在配置加载完成后把结果放进 state，因此这里以 prop 形式接收最可靠。
   */
  canGrantRole: boolean;
  /** 是否有权限查看配置项明文（system:config）——决定是否展示默认密码明文 */
  canReadConfig: boolean;
  /** 关闭弹窗 */
  onClose: () => void;
  /** 创建成功后的回调（父组件用于刷新列表） */
  onCreated: () => void;
}

const CreateUserModal: React.FC<CreateUserModalProps> = ({
  open,
  roles,
  canGrantRole,
  canReadConfig,
  onClose,
  onCreated,
}) => {
  const { message, modal } = App.useApp();
  const [form] = Form.useForm<CreateUserFormValues>();

  const [submitting, setSubmitting] = useState(false);

  /** 当前选择的密码来源（用于条件渲染「自行设置密码」输入框） */
  const passwordMode = Form.useWatch("passwordMode", form) ?? "default";

  /*
   * 下面两个值在每次渲染时直接读 window 配置单例 —— 它们都是 O(1) 的
   * 对象取值，无需 useMemo 缓存。直接读的好处是天然拿到最新值：
   * 管理员刚在「系统设置」改完默认密码，再打开本弹窗就是新值
   * （useMemo 依赖里放外部可变状态反而会被 lint 判为多余依赖）。
   */
  /** 密码最小长度：与后端同一个配置项，避免两边口径漂移 */
  const minLength = getConfigValue<number>("auth.password.min_length", 8);

  /** 系统默认密码（配置项）——仅用于提示文案，不直接回填到表单 */
  const defaultPassword = getConfigValue<string>("auth.user.default_password", "");

  /**
   * 打开弹窗时重置表单并回填「配置驱动」的默认值。
   *
   * - passwordMode 默认 "default"（用系统默认密码，最省事）
   * - status 默认 "active"
   * - roleIds 默认空数组（后端会补默认 user 角色）
   * - mustChangePassword 默认取配置 `auth.user.must_change_password`
   *   （用明文默认密码建号时，强烈建议保持开启）
   */
  useEffect(() => {
    if (!open) return;

    form.resetFields();
    form.setFieldsValue({
      passwordMode: "default",
      status: "active",
      roleIds: [],
      mustChangePassword: getConfigValue<boolean>(
        "auth.user.must_change_password",
        true
      ),
    });
    // form 实例在整个组件生命周期内稳定，无需加入依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ============================================================
  // 校验器
  // ============================================================

  /**
   * 生成「标识唯一性」异步校验器。
   *
   * 【失败时的降级策略】
   * 校验接口不可用（网络异常 / 无权限）时**直接放行**，把判定权交给后端。
   * 理由：前端校验只是体验优化，若因校验接口挂了就禁止建号，反而更糟。
   *
   * @param field - 要校验的标识字段
   */
  const makeUniqueValidator =
    (field: IdentifierField) =>
    async (_rule: FormRule, value: string): Promise<void> => {
      const raw = (value ?? "").trim();
      if (!raw) return; // 空值合法性交给「至少填一个」的整体校验

      const res = await checkIdentityApi(field, raw);
      if (!res.success || !res.data) return; // 降级放行，由后端兜底

      if (res.data.exists) {
        throw new Error(`${IDENTIFIER_LABELS[field]}已被占用，请换一个`);
      }
    };

  /** 邮箱格式校验（必填性由整体校验负责，这里只管格式） */
  const emailRules: FormRule[] = [
    {
      validator: (_rule, value: string) => {
        const raw = (value ?? "").trim();
        if (!raw) return Promise.resolve();
        return EMAIL_PATTERN.test(raw.toLowerCase())
          ? Promise.resolve()
          : Promise.reject(new Error("邮箱格式不正确"));
      },
    },
    { validator: makeUniqueValidator("email") },
  ];

  /** 手机号格式 + 唯一性校验 */
  const phoneRules: FormRule[] = [
    {
      validator: (_rule, value: string) => {
        const err = validatePhone(value ?? "");
        return err ? Promise.reject(new Error(err)) : Promise.resolve();
      },
    },
    { validator: makeUniqueValidator("phone") },
  ];

  /** 用户名格式 + 唯一性校验 */
  const usernameRules: FormRule[] = [
    {
      validator: (_rule, value: string) => {
        const raw = (value ?? "").trim();
        if (!raw) return Promise.resolve();
        const err = validateUsername(raw);
        return err ? Promise.reject(new Error(err)) : Promise.resolve();
      },
    },
    { validator: makeUniqueValidator("username") },
  ];

  // ============================================================
  // 提交
  // ============================================================

  /**
   * 提交创建。
   *
   * 流程：整表校验 → 组装 payload（空串转 undefined）→ 调接口
   *      → 成功弹出「账号摘要」结果弹窗 → 通知父组件刷新列表。
   */
  const handleSubmit = async () => {
    let values: CreateUserFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return; // 校验失败的提示已由表单逐项展示
    }

    // ---------- 手工校验：三个登录标识至少填一个 ----------
    // 这条规则跨三个字段，用单字段 rule 表达很别扭，放在提交前整体判断更清晰。
    const email = values.email?.trim() || undefined;
    const phone = values.phone?.trim() || undefined;
    const username = values.username?.trim() || undefined;

    if (!email && !phone && !username) {
      message.error("请至少填写一个登录标识（邮箱 / 手机号 / 用户名）");
      return;
    }

    // ---------- 自行设置密码时再校验一次强度 ----------
    // 表单里已有 rule，这里兜一层是为了防「rule 被绕过」的极端情况，
    // 保证到达后端的一定是合格密码（后端同样会再校验一次）。
    if (values.passwordMode === "custom") {
      const err = validatePassword(values.password ?? "", minLength);
      if (err) {
        message.error(err);
        return;
      }
    }

    const payload: CreateUserParams = {
      email,
      phone,
      username,
      name: values.name?.trim() || undefined,
      remark: values.remark?.trim() || undefined,
      passwordMode: values.passwordMode,
      password:
        values.passwordMode === "custom" ? values.password : undefined,
      // 无分配角色权限时不传 roleIds，由后端绑定默认 user 角色
      roleIds: canGrantRole ? values.roleIds ?? [] : [],
      status: values.status,
      mustChangePassword: values.mustChangePassword,
    };

    setSubmitting(true);
    const res = await createUserApi(payload);
    setSubmitting(false);

    if (!res.success || !res.data) {
      message.error(res.message || "创建用户失败");
      return;
    }

    showResult(res.data);
    onCreated();
  };

  /**
   * 创建成功后的账号摘要弹窗。
   *
   * 【为什么要在成功后再弹一个摘要】
   * 管理员需要把这些信息转告给新用户（登录账号 + 初始密码来源）。
   * 一个可复制的摘要比一条飘过的 toast 有用得多。
   */
  const showResult = (data: CreateUserResult) => {
    const identifierText = [
      data.email ? `邮箱：${data.email}` : null,
      data.phone ? `手机号：${data.phone}` : null,
      data.username ? `用户名：${data.username}` : null,
    ]
      .filter(Boolean)
      .join("　|　");

    modal.success({
      title: "用户创建成功",
      width: 520,
      okText: "知道了",
      content: (
        <div style={{ fontSize: 13, lineHeight: 1.9 }}>
          <Paragraph style={{ marginTop: 12, marginBottom: 8 }}>
            <Text strong>登录账号：</Text>
            {identifierText || "—"}
          </Paragraph>
          <Paragraph style={{ marginBottom: 8 }}>
            <Text strong>初始密码：</Text>
            {data.usedDefaultPassword ? (
              <>
                使用系统默认密码
                {canReadConfig && defaultPassword ? (
                  <>
                    （<Text code>{defaultPassword}</Text>）
                  </>
                ) : (
                  <Text type="secondary">
                    （可在「系统设置 → 登录与账号 → 新增用户默认密码」查看）
                  </Text>
                )}
              </>
            ) : (
              "由管理员自行设置（请自行妥善传递）"
            )}
          </Paragraph>
          <Paragraph style={{ marginBottom: 8 }}>
            <Text strong>角色：</Text>
            <Space size={4} wrap>
              {data.roles.length > 0 ? (
                data.roles.map((r) => (
                  <Tag color="blue" key={r.id}>
                    {r.name}
                  </Tag>
                ))
              ) : (
                <Tag>未分配</Tag>
              )}
            </Space>
          </Paragraph>
          {data.mustChangePassword && (
            <Alert
              type="warning"
              showIcon
              title="该账号已开启「首次登录强制修改密码」，用户登录后必须先改密码才能继续使用。"
            />
          )}
        </div>
      ),
    });
  };

  // ============================================================
  // 渲染
  // ============================================================

  return (
    <Modal
      title="新增用户"
      open={open}
      onCancel={onClose}
      onOk={handleSubmit}
      confirmLoading={submitting}
      okText="创建"
      cancelText="取消"
      width={620}
      // antd v6：maskClosable 已弃用，改用 mask={{ closable }}
      // 点击遮罩不关闭 —— 表单填了一半误点遮罩就全丢，代价太高
      mask={{ closable: false }}
    >
      <Form<CreateUserFormValues> form={form} layout="vertical" requiredMark>
        {/* ---------------- 登录标识 ---------------- */}
        <Divider titlePlacement="start" style={{ marginTop: 0, fontSize: 13 }}>
          登录标识
        </Divider>

        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          title="三个标识至少填写一个"
          description="邮箱是自动生成的账号（方便找回密码）；手机号需企业在短信通道就绪后才能用于验证码登录；用户名最适合内部账号。三个都填也可以，用户可用任意一个登录。"
        />

        <Form.Item
          name="email"
          label="邮箱"
          rules={emailRules}
          validateDebounce={500}
          validateFirst
          extra="可选。用户将用这个邮箱登录"
        >
          <Input
            allowClear
            prefix={<MailOutlined style={{ color: "#9ca3af" }} />}
            placeholder="如 zhangsan@example.com"
            autoComplete="off"
          />
        </Form.Item>

        <Form.Item
          name="phone"
          label="手机号"
          rules={phoneRules}
          validateDebounce={500}
          validateFirst
          extra="可选。11 位中国大陆手机号，存库会自动去掉空格与中划线"
        >
          <Input
            allowClear
            prefix={<MobileOutlined style={{ color: "#9ca3af" }} />}
            placeholder="如 13800001111"
            autoComplete="off"
          />
        </Form.Item>

        <Form.Item
          name="username"
          label="用户名"
          rules={usernameRules}
          validateDebounce={500}
          validateFirst
          extra={USERNAME_HINT}
        >
          <Input
            allowClear
            prefix={<UserOutlined style={{ color: "#9ca3af" }} />}
            placeholder="如 zhangsan"
            autoComplete="off"
          />
        </Form.Item>

        {/* ---------------- 基本信息 ---------------- */}
        <Divider titlePlacement="start" style={{ fontSize: 13 }}>
          基本信息
        </Divider>

        <Form.Item name="name" label="昵称" extra="可留空，留空时列表里显示「—」">
          <Input allowClear placeholder="如 张三" maxLength={32} autoComplete="off" />
        </Form.Item>

        <Form.Item
          name="remark"
          label="管理员备注"
          extra="仅后台可见，用于记录建号原因（如「市场部实习生，2026-10 到期」）"
        >
          <Input.TextArea
            allowClear
            rows={2}
            maxLength={200}
            showCount
            placeholder="可选"
          />
        </Form.Item>

        {/* ---------------- 初始密码 ---------------- */}
        <Divider titlePlacement="start" style={{ fontSize: 13 }}>
          初始密码
        </Divider>

        <Form.Item name="passwordMode" label="密码来源" style={{ marginBottom: 12 }}>
          <Radio.Group>
            <Radio.Button value="default">
              <KeyOutlined /> 使用系统默认密码
            </Radio.Button>
            <Radio.Button value="custom">管理员自行设置</Radio.Button>
          </Radio.Group>
        </Form.Item>

        {passwordMode === "default" ? (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            title="将使用系统配置的默认密码"
            description={
              <span>
                密码来自「系统设置 → 登录与账号 → 新增用户默认密码」
                {canReadConfig && defaultPassword ? (
                  <>
                    ，当前值 <Text code>{defaultPassword}</Text>
                  </>
                ) : null}
                。该配置为明文存储，仅适合内部/测试账号；正式对外账号建议改用「管理员
                自行设置」，并保持下方「首次登录强制修改密码」开启。
              </span>
            }
          />
        ) : (
          <Form.Item
            name="password"
            label="初始密码"
            rules={[
              {
                validator: (_rule, value: string) => {
                  const err = validatePassword(value ?? "", minLength);
                  return err ? Promise.reject(new Error(err)) : Promise.resolve();
                },
              },
            ]}
            extra={passwordRuleHint(minLength)}
          >
            <Input.Password
              allowClear
              placeholder="请输入初始密码"
              autoComplete="new-password"
            />
          </Form.Item>
        )}

        {/* ---------------- 角色与状态 ---------------- */}
        <Divider titlePlacement="start" style={{ fontSize: 13 }}>
          角色与状态
        </Divider>

        {canGrantRole ? (
          <Form.Item
            name="roleIds"
            label="角色"
            extra="不选则自动绑定默认角色「普通用户」，保证新账号登录后有基础菜单"
          >
            <Select
              mode="multiple"
              allowClear
              placeholder="请选择角色"
              options={roles.map((r) => ({
                value: r.id,
                label: `${r.name}（${r.code}）`,
              }))}
              optionFilterProp="label"
            />
          </Form.Item>
        ) : (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 24 }}
            title="你当前没有「分配角色」权限"
            description="该账号将自动绑定默认角色「普通用户」。如需分配其它角色，请联系管理员开通 system:user:grant 权限。"
          />
        )}

        <Form.Item name="status" label="账号状态">
          <Radio.Group>
            <Radio value="active">启用（可正常登录）</Radio>
            <Radio value="disabled">停用（暂不可登录）</Radio>
          </Radio.Group>
        </Form.Item>

        <Form.Item
          name="mustChangePassword"
          label="首次登录强制修改密码"
          valuePropName="checked"
          extra="开启后，该用户用初始密码登录会被要求先改密码。使用系统默认密码建号时建议保持开启"
          style={{ marginBottom: 0 }}
        >
          <Switch checkedChildren="开" unCheckedChildren="关" />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default CreateUserModal;
