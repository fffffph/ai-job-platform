"use client";

/**
 * ============================================
 * 修改登录标识弹窗（IdentifierModal）
 * ============================================
 *
 * 【它解决什么问题】
 * 统一账号模型下，一个账号可以有 邮箱 / 手机号 / 用户名 三个登录标识，
 * 且都可以为空。用户必须能：
 * - 看到自己当前有哪些标识（在个人中心列表里）
 * - 改掉写错的邮箱（旧版本邮箱是 disabled 只读，写错就永远改不了）
 * - 给没设过的账号补一个手机号 / 用户名
 *
 * 【为什么每次只改一个标识】
 * 三个标识的格式规则、占位提示、错误文案都不同，做成「一次改三个」的表单
 * 既冗长又容易误操作（把不想改的那个也一起提交了）。这里按行弹单字段，
 * 未涉及的字段**根本不提交**，由后端按 PATCH 语义保持原值。
 *
 * 【为什么必须填当前密码】
 * 在没有「新邮箱收验证码」能力之前（个人开发、无短信/邮件服务商资质），
 * 改登录标识是账号劫持的最高危入口：别人趁你电脑没锁屏，把邮箱换成他的，
 * 再走「忘记密码」就能永久接管账号。用「输入当前密码」做二次确认，
 * 是当前成本最低、收益最高的折中方案。
 *
 * 【「未验证」是什么意思】
 * 后端目前只校验标识的**格式**与**唯一性**，没有发码验证归属。
 * 界面上如实标注「未验证」，等 A-P1 有验证码能力后再升级为「已验证」，
 * 不假装已经验证过 —— 安全提示失真比没有提示更危险。
 */

import React, { useCallback, useEffect, useState } from "react";
import { Modal, Form, Input, Button, Alert, Tag, App } from "antd";
import { Mail, Smartphone, User as UserIcon, Lock } from "lucide-react";
import { updateIdentifiersApi, setToken, isTokenRemembered, ERROR_MESSAGES } from "@/api";
import type { UserProfile, IdentifierField } from "@/api";
import {
  IDENTIFIER_LABELS,
  USERNAME_HINT,
  EMAIL_PATTERN,
  validatePhone,
  validateUsername,
} from "@/lib/identifier";

/** 三个标识各自的图标与占位提示 */
const FIELD_META: Record<
  IdentifierField,
  { Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; placeholder: string; hint: string }
> = {
  email: {
    Icon: Mail,
    placeholder: "you@example.com",
    hint: "用于接收通知与未来的验证码登录",
  },
  phone: {
    Icon: Smartphone,
    placeholder: "138 0000 0000",
    hint: "11 位中国大陆手机号，可带空格或中划线（保存时自动去掉）",
  },
  username: {
    Icon: UserIcon,
    placeholder: "例如 zhangsan",
    hint: USERNAME_HINT,
  },
};

export interface IdentifierModalProps {
  /** 是否可见 */
  open: boolean;
  /** 本次要修改的标识字段 */
  field: IdentifierField;
  /** 当前用户资料（用于回填原值与做「至少保留一个」预检） */
  profile: UserProfile;
  /** 关闭弹窗 */
  onClose: () => void;
  /**
   * 更新成功回调。
   *
   * @param profile - 后端返回的最新资料
   * @param token   - 邮箱变更时后端重签的 Token（需替换本地存储）
   */
  onUpdated: (profile: UserProfile, token?: string) => void;
}

interface IdentifierFormValues {
  /** 新的标识值（清空即代表删除该标识） */
  value: string;
  /** 当前密码（身份确认） */
  password: string;
}

const IdentifierModal: React.FC<IdentifierModalProps> = ({
  open,
  field,
  profile,
  onClose,
  onUpdated,
}) => {
  const { message } = App.useApp();
  const [form] = Form.useForm<IdentifierFormValues>();
  const [submitting, setSubmitting] = useState(false);

  const meta = FIELD_META[field];
  const label = IDENTIFIER_LABELS[field];
  const currentValue = profile[field] ?? "";

  // ---------- 打开时回填原值 ----------
  useEffect(() => {
    if (!open) return;
    form.setFieldsValue({ value: profile[field] ?? "", password: "" });
  }, [open, field, profile, form]);

  /**
   * 提交。
   *
   * 【载荷为什么只带这一个字段】
   * 后端按 PATCH 语义处理：undefined = 保持原值，"" = 清空。
   * 因此这里只提交「本次编辑的字段 + 当前密码」，
   * 绝对不会误伤另外两个标识。
   */
  const handleSubmit = useCallback(
    async (values: IdentifierFormValues) => {
      setSubmitting(true);

      const res = await updateIdentifiersApi({
        password: values.password,
        // 用 [field] 动态键：一次只提交一个标识
        [field]: values.value?.trim() ?? "",
      } as Parameters<typeof updateIdentifiersApi>[0]);

      if (res.success) {
        // 邮箱变更时后端会重签 Token —— 必须替换本地存储，否则 JWT payload
        // 里的 email 会与数据库长期不一致。
        if (res.data.token) {
          // 沿用用户原来的持久化策略：原先存在 localStorage（记住我）就继续持久化，
          // 原先只在 sessionStorage 就保持会话级，不擅自改变用户的登录习惯。
          setToken(res.data.token, isTokenRemembered());
        }

        message.success(`${label}已更新`);
        onUpdated(res.data.profile, res.data.token);
        onClose();
      } else {
        /**
         * 错误提示优先用后端 message。
         *
         * 【为什么不用 ERROR_MESSAGES 打头】
         * 后端对「标识冲突」返回的是精准文案（如「邮箱已被占用，请更换」），
         * 而前端错误码表里是通用文案（「该账号标识已被占用，请换一个」）。
         * 这里优先展示更具体的那条，用户才知道该改哪个。
         */
        message.error(res.message || (res.code && ERROR_MESSAGES[res.code]) || "修改失败");
      }

      setSubmitting(false);
    },
    [field, label, message, onClose, onUpdated]
  );

  /**
   * 单字段校验规则。
   *
   * 【为什么允许清空】
   * 三个标识可空是设计的一部分（管理员可能只给用户建了手机号）。
   * 但「三个全清空」会让账号无法登录，所以在这里提前拦一道，
   * 让用户立刻看到原因，而不是等后端返回 400 再猜。
   */
  const rules = [
    {
      validator: (_rule: unknown, raw: string) => {
        const value = (raw ?? "").trim();

        // 清空 → 检查是否会一个标识都不剩
        if (!value) {
          const others = (["email", "phone", "username"] as IdentifierField[]).filter(
            (f) => f !== field && Boolean(profile[f])
          );
          if (others.length === 0) {
            return Promise.reject(
              new Error("至少需要保留一个登录标识，否则将无法登录")
            );
          }
          return Promise.resolve();
        }

        if (field === "email") {
          return EMAIL_PATTERN.test(value.toLowerCase())
            ? Promise.resolve()
            : Promise.reject(new Error("邮箱格式不正确，请检查是否缺少 @ 或域名"));
        }

        if (field === "phone") {
          const err = validatePhone(value);
          return err ? Promise.reject(new Error(err)) : Promise.resolve();
        }

        const err = validateUsername(value);
        return err ? Promise.reject(new Error(err)) : Promise.resolve();
      },
    },
  ];

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={`修改${label}`}
      width={480}
      okText="保存"
      cancelText="取消"
      confirmLoading={submitting}
      // 点击遮罩不关闭：表单里可能有半填的内容，避免误触丢失
      mask={{ closable: false }}
      afterClose={() => form.resetFields()}
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={submitting} onClick={() => form.submit()}>
            保存
          </Button>
        </div>
      }
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        title="修改登录标识需要验证当前密码"
        description={
          <span style={{ fontSize: 12, lineHeight: 1.7 }}>
            登录标识可以用来登录本系统，属于高敏感信息，因此修改前需要确认身份。
            <br />
            标识目前仅校验格式与唯一性，
            <Tag color="default" style={{ marginInline: 4, fontSize: 11 }}>
              未验证
            </Tag>
            表示尚未通过验证码确认归属（验证码能力开放后会自动升级）。
          </span>
        }
      />

      <Form
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
        requiredMark={false}
        autoComplete="off"
      >
        <Form.Item
          name="value"
          label={label}
          extra={
            <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
              {meta.hint}
              {currentValue ? "（清空即删除该标识）" : ""}
            </span>
          }
          rules={rules}
        >
          {/*
            autoComplete 必须放在 Input 这一层：
            浏览器密码管理器会忽略 <form> 上的 autoComplete="off"，
            单独标注才能减少误回填（配合下方密码框的 new-password 使用）。
          */}
          <Input
            prefix={<meta.Icon className="w-4 h-4" style={{ opacity: 0.45 }} />}
            placeholder={meta.placeholder}
            allowClear
            autoComplete="off"
          />
        </Form.Item>

        <Form.Item
          name="password"
          label="当前密码"
          rules={[{ required: true, message: "请输入当前密码以确认身份" }]}
        >
          {/*
            【为什么用 new-password 而不是 current-password】
            标 current-password 时，Chrome/Edge 的密码管理器会把本表单里
            「唯一的文本输入框」按用户名配对回填 —— 这就是手机号/邮箱弹窗
            打开时被自动填入登录账号（如 cs1）的根因，三个标识弹窗共用本组件，
            因此全部受影响。改成 new-password 后浏览器不再自动填充已保存的
            账号密码，身份确认框由用户手动输入，既修复回填又不影响安全性。
          */}
          <Input.Password
            prefix={<Lock className="w-4 h-4" style={{ opacity: 0.45 }} />}
            placeholder="请输入登录密码"
            autoComplete="new-password"
          />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default IdentifierModal;
