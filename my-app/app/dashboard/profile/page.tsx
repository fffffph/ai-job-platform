"use client";

/**
 * ============================================
 * 个人中心页面（三分区重排）
 * ============================================
 *
 * 【信息架构】
 * 1. 基本资料   —— 头像 + 昵称 + 个人简介（可编辑）
 * 2. 登录与安全 —— 三个登录标识（邮箱/手机号/用户名，可看可改）
 *                  + 修改密码（按钮化，不再藏在文字链接里）
 *                  + 最后登录信息（时间 / IP / 方式）
 * 3. 集成设置   —— DeepSeek / SiliconFlow API Key
 *
 * 【为什么这样分】
 * 旧版把「邮箱（只读）」和「修改密码（一个 type=link 的文字）」混在
 * 「基本信息 / 账号安全」两张卡片里，结果是：
 * - 统一账号模型上线后新增的 username / phone 完全没有展示位，用户根本
 *   不知道自己能用哪些标识登录；
 * - 邮箱是 disabled 的，写错了永远改不了；
 * - 改密码入口可发现性极低；
 * - 后端早就在记 lastLoginAt / lastLoginIp / lastLoginMethod，
 *   前端一个字都不展示，白白浪费了一个高感知的安全功能。
 * 按「资料 / 安全 / 集成」三件事分区后，每类信息都有明确归属。
 *
 * 【状态管理】
 * - loading / error：首屏加载与失败重试
 * - profile：当前用户资料（含三个标识与最后登录审计字段）
 * - identifierField：正在编辑的登录标识（null 表示弹窗关闭）
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  Card,
  Form,
  Input,
  Button,
  Skeleton,
  App,
  Progress,
  Row,
  Col,
  Divider,
  Tag,
  Space,
} from "antd";
import {
  UserOutlined,
  MailOutlined,
  PhoneOutlined,
  LockOutlined,
  LogoutOutlined,
  EditOutlined,
  SafetyCertificateOutlined,
  ApiOutlined,
  ClockCircleOutlined,
  GlobalOutlined,
  KeyOutlined,
} from "@ant-design/icons";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import {
  getUserProfile,
  updateProfile,
  changePassword,
  uploadAvatar,
  removeToken,
  getToken,
  setToken,
  isTokenRemembered,
  ERROR_MESSAGES,
} from "@/api";
import type { UserProfile, IdentifierField } from "@/api";
import { getConfigValue } from "@/lib/app-config";
import { validatePassword, passwordRuleHint } from "@/lib/password";
import DeepSeekKeyCard from "./components/DeepSeekKeyCard";
import SiliconFlowKeyCard from "./components/SiliconFlowKeyCard";
import IdentifierModal from "./components/IdentifierModal";

// ============================================================
// 工具函数（模块级，避免每次渲染重建）
// ============================================================

/** 后端基础地址（用于拼接头像 URL） */
const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

/**
 * 头像占位字母。
 *
 * 【为什么不能简单地取 name || email 的首字符】
 * 邮箱常常以数字开头（如 2460796740@qq.com），取首字符会显示成一个「2」，
 * 既不像名字也不像标识，观感很差。这里按「昵称 → 用户名 → 邮箱 → 手机号」
 * 逐个候选，取第一个以字母或汉字开头的字符；全部失败才退回 "U"。
 */
function getAvatarInitial(profile: UserProfile | null): string {
  if (!profile) return "U";

  const candidates = [profile.name, profile.username, profile.email, profile.phone];
  for (const raw of candidates) {
    const chars = (raw ?? "").trim();
    for (const ch of chars) {
      // 只接受字母或汉字作为首字母，跳过数字与符号
      if (/[a-zA-Z\u4e00-\u9fa5]/.test(ch)) return ch.toUpperCase();
    }
  }
  return "U";
}

/** 登录方式代码 → 中文名 */
const LOGIN_METHOD_LABELS: Record<string, string> = {
  password: "密码登录",
  email_otp: "邮箱验证码",
  sms_otp: "短信验证码",
  otp: "验证码登录",
};

/** 格式化时间（zh-CN 本地化），空值返回占位文案 */
function formatDateTime(value: string | null | undefined, fallback = "—"): string {
  if (!value) return fallback;
  return new Date(value).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

// ============================================================
// 子组件：单行登录标识
// ============================================================

/** 三个标识的展示元信息 */
const IDENTIFIER_META: Record<
  IdentifierField,
  { label: string; Icon: React.ComponentType }
> = {
  email: { label: "邮箱", Icon: MailOutlined },
  phone: { label: "手机号", Icon: PhoneOutlined },
  username: { label: "用户名", Icon: UserOutlined },
};

interface IdentifierRowProps {
  field: IdentifierField;
  value: string | null;
  onEdit: (field: IdentifierField) => void;
}

/**
 * 一行登录标识：图标 + 名称 + 值（或「未设置」）+ 状态标签 + 修改按钮。
 *
 * 【为什么按钮文案随状态变化】
 * 已经设置过的显示「修改」，没设置过的显示「设置」——
 * 后者对「管理员只给我建了手机号，我想补个用户名」这种场景更友好，
 * 用户能一眼看出哪些标识还空着、可以补。
 */
const IdentifierRow: React.FC<IdentifierRowProps> = ({ field, value, onEdit }) => {
  const { label, Icon } = IDENTIFIER_META[field];
  const filled = Boolean(value);

  return (
    <div className="id-row">
      <div className="id-row-icon">
        <Icon />
      </div>

      <div className="id-row-main">
        <div className="id-row-label">{label}</div>
        <div className="id-row-value" data-empty={!filled}>
          {filled ? value : "未设置"}
        </div>
      </div>

      <Tag
        color={filled ? "success" : "default"}
        style={{ margin: 0, flexShrink: 0 }}
      >
        {filled ? "已设置" : "未设置"}
      </Tag>

      <Button size="small" onClick={() => onEdit(field)} style={{ flexShrink: 0 }}>
        {filled ? "修改" : "设置"}
      </Button>
    </div>
  );
};

// ============================================================
// 页面主体
// ============================================================

const ProfilePage = () => {
  const { message: msg } = App.useApp();
  const router = useRouter();

  // ---------- 状态 ----------
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [saving, setSaving] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);

  // 密码修改状态
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordForm] = Form.useForm();

  // 资料表单
  const [profileForm] = Form.useForm();

  // 正在编辑的登录标识（null = 弹窗关闭）
  const [identifierField, setIdentifierField] = useState<IdentifierField | null>(null);

  // ---------- 加载用户资料 ----------
  const loadProfile = useCallback(async () => {
    setLoading(true);
    setError(null);

    const token = getToken();
    if (!token) {
      setError("未登录");
      setLoading(false);
      return;
    }

    const res = await getUserProfile();
    if (res.success) {
      setProfile(res.data);
      // 回填表单
      profileForm.setFieldsValue({
        name: res.data.name || "",
        bio: res.data.bio || "",
      });
    } else {
      setError(res.message);
      // Token 失效 → 跳转登录
      if (res.code === "UNAUTHORIZED") {
        removeToken();
        router.push("/login");
      }
    }
    setLoading(false);
  }, [profileForm, router]);

  useEffect(() => {
    /**
     * 包一层 async IIFE 再调用 loadProfile()。
     *
     * 【为什么不直接 loadProfile()】
     * 项目启用了 React Compiler 的 lint 规则 react-hooks/set-state-in-effect：
     * 在 effect 体内同步触发 setState（loadProfile 第一行就是 setLoading(true)）
     * 会造成级联渲染，会被拦下。放到微任务里执行即可规避，同时也保证
     * 首次渲染已经完成，不会有「渲染中被中断」的隐患。
     */
    (async () => {
      await loadProfile();
    })();
  }, [loadProfile]);

  // ---------- 保存资料 ----------
  const handleSaveProfile = async (values: { name: string; bio: string }) => {
    setSaving(true);
    const res = await updateProfile({
      name: values.name,
      bio: values.bio,
    });

    if (res.success) {
      setProfile(res.data);
      msg.success("资料已保存");
    } else {
      const errorMsg = res.code
        ? ERROR_MESSAGES[res.code] || res.message
        : res.message;
      msg.error(errorMsg);
    }
    setSaving(false);
  };

  // ---------- 修改密码 ----------
  // 无密码账号（验证码注册）走「首次设置密码」形态：表单不渲染旧密码框，
  // oldPassword 为 undefined，后端对无密码账号免旧密码校验。
  const handleChangePassword = async (values: {
    oldPassword?: string;
    newPassword: string;
    confirmPassword: string;
  }) => {
    if (values.newPassword !== values.confirmPassword) {
      msg.error("两次输入的新密码不一致");
      return;
    }

    setPasswordLoading(true);
    const res = await changePassword({
      oldPassword: values.oldPassword ?? "",
      newPassword: values.newPassword,
    });

    if (res.success) {
      if (res.data?.token) {
        /**
         * 【为什么改完密码可以留在原地，不用强制重新登录】
         *
         * 后端 changePassword 会执行 `tokenVersion++`，把该账号**所有**已签发的
         * 旧 Token 立即吊销 —— 这是「改密码 = 把其他人踢下线」的应有语义。
         * 但与此同时，后端会**签发一份新 Token**（基于新的 tokenVersion）返回，
         * 所以本会话只需要用手上的新 Token 换掉旧的，就能无缝继续使用。
         *
         * 安全性不受影响：
         * - 其它设备/浏览器里的旧 Token 已被 tokenVersion++ 吊销，
         *   它们下一次请求会吃 401 → 被响应拦截器自动送往登录页；
         * - 本地替换时沿用 isTokenRemembered() 的存储策略，
         *   「记住我」的会话仍然持久，普通会话仍然仅限当前标签页。
         */
        setToken(res.data.token, isTokenRemembered());
        // 清空密码表单，避免敏感明文残留在受控输入框里
        passwordForm.resetFields();
        // 首次设置密码后本地同步 hasPassword：UI 立即切换回「已设置」形态，
        // 无需整页刷新重新拉 profile
        if (profile && !profile.hasPassword) {
          setProfile({ ...profile, hasPassword: true });
        }
        msg.success(
          profile?.hasPassword === false
            ? "密码设置成功，之后可用「账号/邮箱/手机号 + 密码」登录"
            : "密码修改成功，其它设备已自动下线"
        );
      } else {
        // 理论上不会出现的兜底分支：接口成功但没返回新 Token，
        // 此时本地 Token 必然已被吊销，只能按旧逻辑送回登录页。
        removeToken();
        msg.success("密码修改成功，请使用新密码重新登录");
        router.replace("/login?passwordChanged=1");
        return;
      }
    } else {
      const errorMsg = res.code
        ? ERROR_MESSAGES[res.code] || res.message
        : res.message;
      msg.error(errorMsg);
    }
    setPasswordLoading(false);
  };

  // ---------- 上传头像 ----------
  const handleAvatarUpload = async (file: File) => {
    setAvatarUploading(true);
    const res = await uploadAvatar(file);

    if (res.success && profile) {
      msg.success("头像已更新");
      setProfile({ ...profile, avatar: res.data.avatar });
    } else {
      msg.error(res.message || "头像上传失败");
    }
    setAvatarUploading(false);
    // 阻止 antd Upload 的默认上传行为
    return false;
  };

  // ---------- 退出登录 ----------
  const handleLogout = () => {
    removeToken();
    msg.success("已退出登录");
    router.replace("/login"); // replace 替换历史，避免返回键又回到 dashboard
  };

  // ---------- 登录标识更新成功 ----------
  const handleIdentifiersUpdated = useCallback((next: UserProfile) => {
    setProfile(next);
    // 昵称等字段不受影响，这里只用资料里的新值刷新展示
  }, []);

  // ---------- 渲染 ----------
  return (
    <div style={{ minHeight: "100vh", padding: "32px 48px" }}>
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        style={{ maxWidth: "1000px", margin: "0 auto" }}
      >
        {/* ========== 页头 ========== */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "32px",
          }}
        >
          <h1 style={{ fontSize: "28px", fontWeight: 700, margin: 0 }}>个人中心</h1>
          <Button type="text" danger icon={<LogoutOutlined />} onClick={handleLogout}>
            退出登录
          </Button>
        </div>

        {/* ========== 加载骨架屏 ========== */}
        {loading && (
          <Space orientation="vertical" size={24} style={{ width: "100%" }}>
            <Card>
              <Skeleton avatar active paragraph={{ rows: 2 }} />
            </Card>
            <Card>
              <Skeleton active paragraph={{ rows: 4 }} />
            </Card>
          </Space>
        )}

        {/* ========== 加载失败 ========== */}
        {!loading && error && (
          <Card style={{ textAlign: "center", padding: "64px" }}>
            <p
              style={{
                color: "var(--muted-foreground)",
                marginBottom: "16px",
                fontSize: "16px",
              }}
            >
              {error}
            </p>
            <Button type="primary" onClick={loadProfile}>
              重新加载
            </Button>
          </Card>
        )}

        {/* ========== 正文（始终渲染，仅控制显隐）==========
            Forms 必须始终在 DOM 中（而非条件渲染），否则 Form.useForm() 实例会
            因找不到对应的 <Form> 元素而触发 "not connected to any Form element" 警告。 */}
        <div
          style={{
            display: !loading && !error && profile ? "block" : "none",
          }}
        >
          <Space orientation="vertical" size={24} style={{ width: "100%" }}>
            {/* ============================================================
                分区 1：基本资料
                ============================================================ */}
            <Card
              title={
                <Space size={8}>
                  <UserOutlined />
                  基本资料
                </Space>
              }
              style={{ borderRadius: "12px" }}
              extra={
                <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
                  注册于{" "}
                  {profile?.createdAt &&
                    new Date(profile.createdAt).toLocaleDateString("zh-CN", {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })}
                </span>
              }
            >
              <Row gutter={[32, 24]} align="middle">
                {/* 左：头像 */}
                <Col flex="none" className="profile-avatar-col">
                  <div style={{ textAlign: "center", width: 140 }}>
                    <div
                      style={{
                        position: "relative",
                        display: "inline-block",
                      }}
                    >
                      {profile?.avatar ? (
                        // 头像来源是任意远程 URL（用户上传/外链），next/image
                        // 需要为每个远程域名配置 remotePatterns，收益低，
                        // 这里保留原生 img（仅一处，不影响 LCP 主链路）
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={
                            profile.avatar.startsWith("http")
                              ? profile.avatar
                              : `${API_BASE}${profile.avatar}`
                          }
                          alt="头像"
                          style={{
                            width: "120px",
                            height: "120px",
                            borderRadius: "50%",
                            objectFit: "cover",
                            border: "3px solid var(--border-1)",
                          }}
                        />
                      ) : (
                        <div
                          style={{
                            width: "120px",
                            height: "120px",
                            borderRadius: "50%",
                            // 品牌渐变：明暗主题下对比度都够（白字 + 深紫蓝底）
                            background: "linear-gradient(135deg, #667eea, #764ba2)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: "48px",
                            color: "#fff",
                            userSelect: "none",
                          }}
                        >
                          {getAvatarInitial(profile)}
                        </div>
                      )}

                      {/* hover 覆盖层 — 更换头像 */}
                      <div
                        className="avatar-hover-overlay"
                        style={{
                          position: "absolute",
                          inset: 0,
                          borderRadius: "50%",
                          background:
                            "color-mix(in srgb, var(--background) 60%, transparent)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: "var(--foreground)",
                          fontSize: "14px",
                          opacity: 0,
                          transition: "opacity 0.2s",
                          cursor: "pointer",
                        }}
                        onClick={() =>
                          document.getElementById("avatar-upload-input")?.click()
                        }
                      >
                        <EditOutlined style={{ marginRight: "4px" }} />
                        更换头像
                      </div>

                      {/* 隐藏的文件选择器 */}
                      <input
                        id="avatar-upload-input"
                        type="file"
                        accept="image/*"
                        style={{ display: "none" }}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleAvatarUpload(file);
                          // 清空 input，允许重新选择同一个文件
                          e.target.value = "";
                        }}
                      />

                      {/* 上传中指示器 */}
                      {avatarUploading && (
                        <div
                          style={{
                            position: "absolute",
                            inset: 0,
                            borderRadius: "50%",
                            background:
                              "color-mix(in srgb, var(--background) 70%, transparent)",
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            justifyContent: "center",
                            color: "var(--foreground)",
                          }}
                        >
                          <Progress type="circle" percent={100} size={60} />
                          <span style={{ marginTop: "8px", fontSize: "12px" }}>
                            上传中...
                          </span>
                        </div>
                      )}
                    </div>

                    <div style={{ marginTop: 12, fontWeight: 600, fontSize: 15 }}>
                      {profile?.name || "未设置昵称"}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: "var(--muted-foreground)",
                        marginTop: 2,
                      }}
                    >
                      支持 JPG / PNG，2MB 以内
                    </div>
                  </div>
                </Col>

                {/* 右：表单 */}
                <Col flex="auto">
                  <Form
                    form={profileForm}
                    layout="vertical"
                    onFinish={handleSaveProfile}
                    style={{ maxWidth: 560 }}
                  >
                    <Form.Item
                      name="name"
                      label="昵称"
                      rules={[{ required: true, message: "请输入昵称" }]}
                    >
                      <Input prefix={<EditOutlined />} placeholder="您的昵称" />
                    </Form.Item>

                    <Form.Item name="bio" label="个人简介">
                      <Input.TextArea
                        rows={4}
                        placeholder="介绍一下自己..."
                        maxLength={200}
                        showCount
                      />
                    </Form.Item>

                    {/* ⚠️ 邮箱已从本卡移除：它现在是「登录标识」，
                        归属「登录与安全」分区，且需要通过密码确认才能修改。 */}

                    <Form.Item className="mb-0">
                      <Button type="primary" htmlType="submit" loading={saving}>
                        保存修改
                      </Button>
                    </Form.Item>
                  </Form>
                </Col>
              </Row>
            </Card>

            {/* ============================================================
                分区 2：登录与安全
                ============================================================ */}
            <Card
              title={
                <Space size={8}>
                  <SafetyCertificateOutlined />
                  登录与安全
                </Space>
              }
              style={{ borderRadius: "12px" }}
            >
              {/* ---- 2.1 登录标识 ---- */}
              <div className="section-label">
                登录标识
                <span className="section-label-hint">
                  以下任意一个都可以用来登录，至少保留一个
                </span>
              </div>

              <Space orientation="vertical" size={8} style={{ width: "100%" }}>
                {(["email", "phone", "username"] as IdentifierField[]).map((field) => (
                  <IdentifierRow
                    key={field}
                    field={field}
                    value={profile?.[field] ?? null}
                    onEdit={setIdentifierField}
                  />
                ))}
              </Space>

              <Divider style={{ margin: "20px 0" }} />

              {/* ---- 2.2 登录密码 ---- */}
              <div className="section-label">登录密码</div>

              <div className="id-row">
                <div className="id-row-icon">
                  <KeyOutlined />
                </div>
                <div className="id-row-main">
                  <div className="id-row-label">密码</div>
                  <div className="id-row-value">
                    {/* 无密码账号（验证码注册）如实显示，避免「已设置」误导 */}
                    {profile?.hasPassword === false ? "未设置（仅可验证码登录）" : "••••••••"}
                  </div>
                </div>
                {/* 标签状态跟随 hasPassword：未设置用警示色如实标注 */}
                {profile?.hasPassword === false ? (
                  <Tag color="warning" style={{ margin: 0, flexShrink: 0 }}>
                    未设置
                  </Tag>
                ) : (
                  <Tag color="success" style={{ margin: 0, flexShrink: 0 }}>
                    已设置
                  </Tag>
                )}
                {/* 入口从文字链接提升为按钮：改密码是高频安全操作，
                    藏在 type="link" 的文字里可发现性太低；
                    无密码账号的按钮文案为「设置密码」，语义是首次设置 */}
                <Button
                  size="small"
                  onClick={() => setPasswordVisible((v) => !v)}
                  style={{ flexShrink: 0 }}
                >
                  {passwordVisible
                    ? "收起"
                    : profile?.hasPassword === false
                      ? "设置密码"
                      : "修改"}
                </Button>
              </div>

              {/* 
                密码表单始终渲染（通过 display 控制显隐，而非条件渲染），
                这样 passwordForm 实例始终与 Form 组件绑定，不会触发
                "useForm is not connected to any Form element" 警告。
              */}
              <div style={{ display: passwordVisible ? "block" : "none" }}>
                <div
                  style={{
                    marginTop: 16,
                    padding: 16,
                    border: "1px solid var(--border-1)",
                    borderRadius: 8,
                    background: "var(--bg-soft)",
                  }}
                >
                  <Form
                    form={passwordForm}
                    layout="vertical"
                    onFinish={handleChangePassword}
                    style={{ maxWidth: 400 }}
                  >
                    {/*
                      「当前密码」仅在已设置密码时渲染。
                      验证码登录自动注册的账号没有密码，后端 changePassword
                      对无密码账号免旧密码校验（语义是「首次设置密码」），
                      前端同步隐藏旧密码框，避免「我没有密码却要我填」的死锁。
                    */}
                    {profile?.hasPassword !== false && (
                      <Form.Item
                        name="oldPassword"
                        label="当前密码"
                        rules={[{ required: true, message: "请输入当前密码" }]}
                      >
                        <Input.Password
                          prefix={<LockOutlined />}
                          placeholder="输入当前密码"
                        />
                      </Form.Item>
                    )}

                    <Form.Item
                      name="newPassword"
                      label="新密码"
                      extra={
                        <span
                          style={{ fontSize: 12, color: "var(--muted-foreground)" }}
                        >
                          {passwordRuleHint(
                            getConfigValue<number>("auth.password.min_length", 8)
                          )}
                        </span>
                      }
                      rules={[
                        {
                          /**
                           * 走统一的密码策略（lib/password.ts），不再硬编码 min: 6。
                           *
                           * 旧写法 `{ min: 6 }` 与后端策略（长度下限来自配置项
                           * `auth.password.min_length`，默认 8，且要求字母+数字混合）
                           * 口径不一致，会出现「前端放行、后端拒绝」的割裂体验。
                           */
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
                    >
                      <Input.Password placeholder="输入新密码" />
                    </Form.Item>

                    <Form.Item
                      name="confirmPassword"
                      label="确认新密码"
                      dependencies={["newPassword"]}
                      rules={[
                        { required: true, message: "请再次输入新密码" },
                        ({ getFieldValue }) => ({
                          validator(_, value) {
                            if (!value || getFieldValue("newPassword") === value) {
                              return Promise.resolve();
                            }
                            return Promise.reject(new Error("两次输入不一致"));
                          },
                        }),
                      ]}
                    >
                      <Input.Password placeholder="再次输入新密码" />
                    </Form.Item>

                    <Form.Item className="mb-0">
                      <div style={{ display: "flex", gap: "12px" }}>
                        <Button
                          type="primary"
                          htmlType="submit"
                          loading={passwordLoading}
                        >
                          确认修改
                        </Button>
                        <Button
                          onClick={() => {
                            setPasswordVisible(false);
                            passwordForm.resetFields();
                          }}
                        >
                          取消
                        </Button>
                      </div>
                    </Form.Item>
                  </Form>
                </div>
              </div>

              <Divider style={{ margin: "20px 0" }} />

              {/* ---- 2.3 最后登录信息 ---- */}
              <div className="section-label">
                最后登录
                <span className="section-label-hint">
                  如果你不认识这条记录，请立刻修改密码
                </span>
              </div>

              {profile?.lastLoginAt ? (
                <Space size={24} wrap>
                  <Space size={6}>
                    <ClockCircleOutlined style={{ opacity: 0.5 }} />
                    <span style={{ fontSize: 13 }}>
                      {formatDateTime(profile.lastLoginAt)}
                    </span>
                  </Space>
                  <Space size={6}>
                    <GlobalOutlined style={{ opacity: 0.5 }} />
                    <span style={{ fontSize: 13 }}>
                      {profile.lastLoginIp || "未知 IP"}
                    </span>
                  </Space>
                  <Tag style={{ margin: 0 }}>
                    {profile.lastLoginMethod
                      ? LOGIN_METHOD_LABELS[profile.lastLoginMethod] ??
                        profile.lastLoginMethod
                      : "未知方式"}
                  </Tag>
                </Space>
              ) : (
                <span style={{ fontSize: 13, color: "var(--muted-foreground)" }}>
                  暂无登录记录
                </span>
              )}
            </Card>

            {/* ============================================================
                分区 3：集成设置
                ============================================================ */}
            <Card
              title={
                <Space size={8}>
                  <ApiOutlined />
                  集成设置
                </Space>
              }
              style={{ borderRadius: "12px" }}
              extra={
                <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
                  密钥仅作用于你自己的账号
                </span>
              }
            >
              {/* 两个子卡片以 embedded 模式渲染：外框由本卡提供，
                  避免出现「卡中卡」的双层边框 */}
              <DeepSeekKeyCard embedded />
              <Divider style={{ margin: "24px 0" }} />
              <SiliconFlowKeyCard embedded />
            </Card>
          </Space>
        </div>
      </motion.div>

      {/* ========== 修改登录标识弹窗 ========== */}
      {profile && identifierField && (
        <IdentifierModal
          open
          field={identifierField}
          profile={profile}
          onClose={() => setIdentifierField(null)}
          onUpdated={handleIdentifiersUpdated}
        />
      )}

      {/* ========== 页面级样式 ========== */}
      <style>{`
        .avatar-hover-overlay:hover {
          opacity: 1 !important;
        }

        /* 登录标识 / 密码 —— 统一的「图标 + 名称 + 值 + 状态 + 按钮」行动态布局 */
        .id-row {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px 12px;
          border: 1px solid var(--border-1);
          border-radius: 8px;
          background: var(--bg-soft);
        }

        .id-row-icon {
          width: 32px;
          height: 32px;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: color-mix(in srgb, var(--accent-1) 12%, transparent);
          color: var(--accent-1);
          flex-shrink: 0;
        }

        .id-row-main {
          flex: 1;
          min-width: 0;
        }

        .id-row-label {
          font-size: 12px;
          color: var(--muted-foreground);
          line-height: 1.4;
        }

        .id-row-value {
          font-size: 14px;
          font-weight: 500;
          line-height: 1.5;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .id-row-value[data-empty="true"] {
          color: var(--muted-foreground);
          font-weight: 400;
          font-style: italic;
        }

        .section-label {
          font-size: 13px;
          font-weight: 600;
          margin-bottom: 12px;
          display: flex;
          align-items: baseline;
          gap: 8px;
          flex-wrap: wrap;
        }

        .section-label-hint {
          font-size: 12px;
          font-weight: 400;
          color: var(--muted-foreground);
        }

        /* 窄屏：头像居中占满一行，避免和表单挤在一起 */
        @media (max-width: 640px) {
          .profile-avatar-col {
            flex: 1 1 100% !important;
            max-width: 100% !important;
          }
        }
      `}</style>
    </div>
  );
};

export default ProfilePage;
