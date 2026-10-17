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
} from "@/lib/identifier";

/** 表单值类型（与表单项 name 一一对应） */
interface EditUserFormValues {
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
    // 账号（username）不可改也不可清空，因此：
    // - 若该用户本就有账号，邮箱/手机号可同时清空（账号仍在，能正常登录）；
    // - 若该用户本就没有账号（纯邮箱/手机号注册），则邮箱、手机号至少保留一个。
    const email = values.email?.trim() || null;
    const phone = values.phone?.trim() || null;

    if (!record.username && !email && !phone) {
      message.error("该用户未设置账号，请至少保留邮箱或手机号中的一项");
      return;
    }

    const payload: UpdateUserParams = {
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
          title="账号（用户名）不可修改"
          description="账号是用户的登录身份标识，创建后固定不变。此处仅可修改邮箱、手机号两个联系方式，且二者不能同时清空，否则该账号将无法登录。"
        />

        <Form.Item
          label="账号（用户名）"
          extra="登录身份标识，创建后不可修改"
        >
          <Input
            disabled
            prefix={<UserOutlined style={{ color: "#9ca3af" }} />}
            value={record?.username ?? "（未设置账号）"}
            autoComplete="off"
          />
        </Form.Item>

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
