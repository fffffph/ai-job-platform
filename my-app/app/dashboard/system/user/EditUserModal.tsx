"use client";

/**
 * ============================================
 * 编辑用户弹窗（EditUserModal）
 * ============================================
 *
 * 【对应任务】B-P1
 *
 * 【职责】
 * 管理员在「用户管理」页点「编辑」后弹出的表单，修改一个已有账号的：
 *   1. 登录标识：邮箱 / 手机号 / 用户名（至少保留一个，均可清空但不可全空）；
 *   2. 基本信息：昵称、管理员备注；
 *   3. 是否首次登录强制改密。
 *
 * 【与 CreateUserModal 的边界（重要，勿混）】
 * - 不含「初始密码」：改密码走独立的「重置密码」弹窗；
 * - 不含「角色」：角色分配走独立的「分配角色」接口（system:user:grant）；
 * - 不含「状态」：停用/启用走独立的「停用/启用」按钮。
 * 这样每个弹窗职责单一，也避免编辑接口重复实现提权防护/密码加密逻辑。
 *
 * 【唯一性校验为什么传 excludeUserId】
 * 编辑时目标用户自己的标识天然「已存在」，若按新增的查重口径会把自己
 * 误判成冲突。因此调用 check-identity 时携带目标用户 id，让后端排除自己
 * （后端 findIdentifierConflict 已支持 excludeUserId）。
 */

import React, { useEffect, useState } from "react";
import { Modal, Form, Input, Switch, Alert, Divider, App } from "antd";
import type { FormRule } from "antd";
import {
  MailOutlined,
  MobileOutlined,
  UserOutlined,
} from "@ant-design/icons";

import { updateUserApi, checkIdentityApi } from "@/api";
import type {
  AdminUserItem,
  IdentifierField,
  UpdateUserParams,
} from "@/api";
import {
  IDENTIFIER_LABELS,
  EMAIL_PATTERN,
  validatePhone,
  validateUsername,
} from "@/lib/identifier";

/** 表单值类型（与表单项 name 一一对应） */
interface EditUserFormValues {
  /** 用户名：仅当目标用户尚未设置时才出现并可编辑（可设置一次） */
  username?: string;
  email?: string;
  phone?: string;
  name?: string;
  remark?: string;
  mustChangePassword: boolean;
}

export interface EditUserModalProps {
  /** 是否可见 */
  open: boolean;
  /** 要编辑的用户（回填原值 + 查重排除自己） */
  record: AdminUserItem | null;
  /** 关闭弹窗 */
  onClose: () => void;
  /** 保存成功后的回调（父组件用于刷新列表） */
  onSaved: () => void;
}

const EditUserModal: React.FC<EditUserModalProps> = ({
  open,
  record,
  onClose,
  onSaved,
}) => {
  const { message } = App.useApp();
  const [form] = Form.useForm<EditUserFormValues>();
  const [submitting, setSubmitting] = useState(false);

  /**
   * 打开弹窗时重置表单并回填目标用户的现值。
   *
   * record 可能随父组件切换目标用户而变化，因此依赖里带上 record。
   */
  useEffect(() => {
    if (!open || !record) return;

    form.resetFields();
    form.setFieldsValue({
      username: record.username ?? "",
      email: record.email ?? "",
      phone: record.phone ?? "",
      name: record.name ?? "",
      remark: record.remark ?? "",
      mustChangePassword: record.mustChangePassword,
    });
  }, [open, record, form]);

  // ============================================================
  // 校验器
  // ============================================================

  /**
   * 生成「标识唯一性」异步校验器（带排除自己）。
   *
   * 【失败时的降级策略】
   * 校验接口不可用（网络异常 / 无权限）时**直接放行**，把判定权交给后端。
   * 前端校验只是体验优化，不是安全边界。
   *
   * @param field - 要校验的标识字段
   */
  const makeUniqueValidator =
    (field: IdentifierField) =>
    async (_rule: FormRule, value: string): Promise<void> => {
      const raw = (value ?? "").trim();
      if (!raw) return; // 空值合法性交给「至少保留一个」的整体校验

      // 编辑场景：排除自己，避免未改动的标识被误判为「已被占用」
      const res = await checkIdentityApi(field, raw, record?.id);
      if (!res.success || !res.data) return; // 降级放行，由后端兜底

      if (res.data.exists) {
        throw new Error(`${IDENTIFIER_LABELS[field]}已被占用，请换一个`);
      }
    };

  /** 邮箱格式校验（可为空，填写时校验格式） */
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

  /**
   * 用户名校验（仅在目标用户尚未设置用户名时可编辑）。
   *
   * 【为什么允许「设置一次」】
   * 验证码登录自动注册的账号 username 为 null，若编辑接口永远沿用现值，
   * 管理员将永远无法为这类用户补全账号 —— 成为管理死角。
   * 后端已同步放开：null 时可设置一次，写库后同样进入不可变状态。
   */
  const usernameRules: FormRule[] = [
    {
      validator: (_rule, value: string) => {
        const err = validateUsername((value ?? "").trim());
        return err ? Promise.reject(new Error(err)) : Promise.resolve();
      },
    },
    { validator: makeUniqueValidator("username") },
  ];

  // ============================================================
  // 提交
  // ============================================================

  const handleSubmit = async () => {
    if (!record) return;

    let values: EditUserFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return; // 校验失败的提示已由表单逐项展示
    }

    // ---------- 手工校验：至少保留一个登录标识 ----------
    // 账号（username）设置后不可改，因此：
    // - 若该用户已有账号，或本次正在设置账号，邮箱/手机号可同时清空；
    // - 若该用户没有账号且本次也不设置，则邮箱、手机号至少保留一个。
    const email = values.email?.trim() || null;
    const phone = values.phone?.trim() || null;
    const newUsername = record.username ? record.username : values.username?.trim() || null;

    if (!newUsername && !email && !phone) {
      message.error("请至少保留账号、邮箱、手机号中的一项，否则该账号将无法登录");
      return;
    }

    const payload: UpdateUserParams = {
      // 用户名：仅在目标用户原本没有时才提交（首次设置）；已有值不传，
      // 后端会强制沿用库中现值 —— 即使强传也不生效
      ...(record.username ? {} : { username: values.username?.trim() || undefined }),
      email,
      phone,
      // 昵称/备注：空串归一为 null（清空）
      name: values.name?.trim() || null,
      remark: values.remark?.trim() || null,
      mustChangePassword: values.mustChangePassword,
    };

    setSubmitting(true);
    const res = await updateUserApi(record.id, payload);
    setSubmitting(false);

    if (!res.success) {
      message.error(res.message || "保存失败，请稍后重试");
      return;
    }

    message.success("已保存");
    onSaved();
  };

  // ============================================================
  // 渲染
  // ============================================================

  return (
    <Modal
      title={record ? `编辑用户 · ${record.name || record.username || record.email || record.id.slice(0, 8)}` : "编辑用户"}
      open={open}
      onCancel={onClose}
      onOk={handleSubmit}
      confirmLoading={submitting}
      okText="保存"
      cancelText="取消"
      width={620}
      // antd v6：maskClosable 已弃用，改用 mask={{ closable }}
      mask={{ closable: false }}
    >
      <Form<EditUserFormValues> form={form} layout="vertical" requiredMark>
        <Divider titlePlacement="start" style={{ marginTop: 0, fontSize: 13 }}>
          登录标识
        </Divider>

        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          title={record?.username ? "账号（用户名）不可修改" : "账号（用户名）仅可设置一次"}
          description={
            record?.username
              ? "账号是用户的登录身份标识，设置后固定不变。此处仅可修改邮箱、手机号两个联系方式，且二者不能同时清空，否则该账号将无法登录。"
              : "该账号由验证码登录自动注册，尚未设置用户名。可以现在为其设置一次用户名，设置后将不可再修改；也可以不设置，仅用邮箱/手机号登录。"
          }
        />

        {record?.username ? (
          // 已有用户名 → 只读展示（不可修改，硬边界在服务端）
          <Form.Item
            label="账号（用户名）"
            extra="登录身份标识，设置后不可修改"
          >
            <Input
              disabled
              prefix={<UserOutlined style={{ color: "#9ca3af" }} />}
              value={record.username}
              autoComplete="off"
            />
          </Form.Item>
        ) : (
          // 未设置用户名（验证码自动注册）→ 允许设置一次
          <Form.Item
            name="username"
            label="账号（用户名）"
            rules={usernameRules}
            validateDebounce={500}
            validateFirst
            extra="可留空。一旦设置不可修改；仅限字母、数字、中划线、下划线，且不能是纯数字"
          >
            <Input
              allowClear
              prefix={<UserOutlined style={{ color: "#9ca3af" }} />}
              placeholder="如 zhangsan（可选）"
              autoComplete="off"
            />
          </Form.Item>
        )}

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

        <Divider titlePlacement="start" style={{ fontSize: 13 }}>
          基本信息
        </Divider>

        <Form.Item name="name" label="昵称" extra="可留空，留空时列表里显示「—」">
          <Input allowClear placeholder="如 张三" maxLength={32} autoComplete="off" />
        </Form.Item>

        <Form.Item
          name="remark"
          label="管理员备注"
          extra="仅后台可见，用于记录账号用途（如「市场部实习生，2026-10 到期」）"
        >
          <Input.TextArea
            allowClear
            rows={2}
            maxLength={200}
            showCount
            placeholder="可选"
          />
        </Form.Item>

        <Form.Item
          name="mustChangePassword"
          label="首次登录强制修改密码"
          valuePropName="checked"
          extra="开启后，该用户下次登录会被要求先改密码"
          style={{ marginBottom: 0 }}
        >
          <Switch checkedChildren="开" unCheckedChildren="关" />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default EditUserModal;
