"use client";

/**
 * ============================================
 * 个人中心页面
 * ============================================
 *
 * 【功能区域】
 * 1. 左侧头像卡片 — 头像展示 + hover 上传
 * 2. 右侧资料表单 — 昵称 + 邮箱(只读) + 简介 + 注册时间
 * 3. 密码修改卡片 — 旧密码 + 新密码 + 确认
 *
 * 【状态管理】
 * - loading: 首次加载骨架屏
 * - error: 加载失败展示重试
 * - profile: 填充表单数据
 * - saving: 保存按钮 loading
 * - avatarUploading: 头像上传中
 */

import React, { useEffect, useState } from "react";
import {
  Card,
  Form,
  Input,
  Button,
  Skeleton,
  App,
  Progress,
  Upload,
  Row,
  Col,
  Divider,
} from "antd";
import {
  UserOutlined,
  MailOutlined,
  CameraOutlined,
  LockOutlined,
  LogoutOutlined,
  EditOutlined,
} from "@ant-design/icons";
import { motion } from "framer-motion";
import {
  getUserProfile,
  updateProfile,
  changePassword,
  uploadAvatar,
  removeToken,
  getToken,
  ERROR_MESSAGES,
} from "@/api";
import type { UserProfile } from "@/api";
import { useRouter } from "next/navigation";

// ============================================================
// 后端基础地址（用于拼接头像 URL）
// ============================================================
const API_BASE =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

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

  // ---------- 加载用户资料 ----------
  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = async () => {
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
        email: res.data.email,
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
  };

  // ---------- 保存资料 ----------
  const handleSaveProfile = async (values: {
    name: string;
    bio: string;
  }) => {
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
  const handleChangePassword = async (values: {
    oldPassword: string;
    newPassword: string;
    confirmPassword: string;
  }) => {
    if (values.newPassword !== values.confirmPassword) {
      msg.error("两次输入的新密码不一致");
      return;
    }

    setPasswordLoading(true);
    const res = await changePassword({
      oldPassword: values.oldPassword,
      newPassword: values.newPassword,
    });

    if (res.success) {
      msg.success("密码修改成功");
      passwordForm.resetFields();
      setPasswordVisible(false);
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
      // 更新本地状态中的头像 URL
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
    router.push("/login");
  };

  // ---------- 渲染 ----------
  return (
    <div style={{ minHeight: "100vh", padding: "32px 48px" }}>
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        style={{ maxWidth: "1200px", margin: "0 auto" }}
      >
        {/* 页面标题 */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "32px",
          }}
        >
          <h1
            style={{
              fontSize: "28px",
              fontWeight: 700,
              margin: 0,
            }}
          >
            个人中心
          </h1>
          <Button
            type="text"
            danger
            icon={<LogoutOutlined />}
            onClick={handleLogout}
          >
            退出登录
          </Button>
        </div>

        {/* ========== 加载骨架屏 ========== */}
        {loading && (
          <div style={{ display: "flex", gap: "24px" }}>
            <Card style={{ width: "300px", flexShrink: 0 }}>
              <Skeleton.Avatar
                active
                size={120}
                style={{ display: "block", margin: "0 auto" }}
              />
              <Skeleton
                active
                paragraph={{ rows: 2 }}
                style={{ marginTop: "24px" }}
              />
            </Card>
            <Card style={{ flex: 1 }}>
              <Skeleton active paragraph={{ rows: 6 }} />
            </Card>
          </div>
        )}

        {/* ========== 加载失败 ========== */}
        {!loading && error && (
          <Card
            style={{
              textAlign: "center",
              padding: "64px",
            }}
          >
            <p style={{ color: "#999", marginBottom: "16px", fontSize: "16px" }}>
              {error}
            </p>
            <Button type="primary" onClick={loadProfile}>
              重新加载
            </Button>
          </Card>
        )}

        {/* ========== 资料展示（始终渲染，仅控制显隐）==========
             Forms 必须始终在 DOM 中（而非条件渲染），否则 Form.useForm() 实例会
             因找不到对应的 <Form> 元素而触发 "not connected to any Form element" 警告。 */}
        <div style={{ display: !loading && !error && profile ? undefined : "none" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr",
              gap: "24px",
            }}
            className="lg-grid-2cols"
          >
            {/* ===== 左侧：头像卡片 ===== */}
            <Card
              className="lg-col-left"
              style={{
                textAlign: "center",
                borderRadius: "12px",
              }}
            >
              <div
                style={{
                  position: "relative",
                  display: "inline-block",
                  marginBottom: "16px",
                }}
              >
                {/* 头像 */}
                {profile && profile.avatar ? (
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
                      border: "3px solid #f0f0f0",
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: "120px",
                      height: "120px",
                      borderRadius: "50%",
                      background: "linear-gradient(135deg, #667eea, #764ba2)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "48px",
                      color: "#fff",
                    }}
                  >
                    {(profile?.name || profile?.email)?.[0]?.toUpperCase() || "U"}
                  </div>
                )}

                {/* hover 覆盖层 — 上传按钮 */}
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    borderRadius: "50%",
                    background: "rgba(0, 0, 0, 0.5)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#fff",
                    fontSize: "14px",
                    opacity: 0,
                    transition: "opacity 0.2s",
                    cursor: "pointer",
                  }}
                  className="avatar-hover-overlay"
                  onClick={() =>
                    document.getElementById("avatar-upload-input")?.click()
                  }
                >
                  <CameraOutlined
                    style={{ marginRight: "4px" }}
                  />
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
                      background: "rgba(0, 0, 0, 0.6)",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#fff",
                    }}
                  >
                    <Progress type="circle" percent={100} size={60} />
                    <span style={{ marginTop: "8px", fontSize: "12px" }}>
                      上传中...
                    </span>
                  </div>
                )}
              </div>

              {/* 昵称 */}
              <h2
                style={{
                  fontSize: "20px",
                  fontWeight: 600,
                  margin: "0 0 4px",
                }}
              >
                {profile?.name || "未设置昵称"}
              </h2>

              {/* 注册时间 */}
              <p style={{ color: "#999", fontSize: "13px", margin: 0 }}>
                注册于{" "}
                {profile?.createdAt && new Date(profile.createdAt).toLocaleDateString("zh-CN", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </p>
            </Card>

            {/* ===== 右侧：表单 + 密码 ===== */}
            <div
              className="lg-col-right"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "24px",
              }}
            >
              {/* 基本信息表单 */}
              <Card
                title="基本信息"
                style={{ borderRadius: "12px" }}
              >
                <Form
                  form={profileForm}
                  layout="vertical"
                  onFinish={handleSaveProfile}
                  style={{ maxWidth: "600px" }}
                >
                  <Row gutter={16}>
                    <Col span={12}>
                      <Form.Item
                        name="name"
                        label="昵称"
                        rules={[
                          { required: true, message: "请输入昵称" },
                        ]}
                      >
                        <Input
                          prefix={<EditOutlined />}
                          placeholder="您的昵称"
                        />
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item name="email" label="邮箱">
                        <Input
                          prefix={<MailOutlined />}
                          disabled
                          style={{ color: "#999" }}
                        />
                      </Form.Item>
                    </Col>
                  </Row>

                  <Form.Item name="bio" label="个人简介">
                    <Input.TextArea
                      rows={4}
                      placeholder="介绍一下自己..."
                      maxLength={200}
                      showCount
                    />
                  </Form.Item>

                  <Form.Item>
                    <Button
                      type="primary"
                      htmlType="submit"
                      loading={saving}
                    >
                      保存修改
                    </Button>
                  </Form.Item>
                </Form>
              </Card>

              {/* 修改密码卡片 */}
              <Card
                title={
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                    }}
                  >
                    <LockOutlined />
                    账号安全
                  </div>
                }
                style={{ borderRadius: "12px" }}
              >
                {!passwordVisible ? (
                  <Button
                    type="link"
                    onClick={() => setPasswordVisible(true)}
                    style={{ padding: 0 }}
                  >
                    修改密码
                  </Button>
                ) : null}

                {/* 
                  密码表单始终渲染（通过 display 控制显隐，而非条件渲染），
                  这样 passwordForm 实例始终与 Form 组件绑定，不会触发
                  "useForm is not connected to any Form element" 警告。
                */}
                <div
                  style={{ display: passwordVisible ? "block" : "none" }}
                >
                  <Form
                    form={passwordForm}
                    layout="vertical"
                    onFinish={handleChangePassword}
                    style={{ maxWidth: "400px" }}
                  >
                    <Form.Item
                      name="oldPassword"
                      label="旧密码"
                      rules={[
                        { required: true, message: "请输入旧密码" },
                      ]}
                    >
                      <Input.Password placeholder="输入旧密码" />
                    </Form.Item>

                    <Form.Item
                      name="newPassword"
                      label="新密码"
                      rules={[
                        { required: true, message: "请输入新密码" },
                        { min: 6, message: "密码至少 6 位" },
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
                            if (
                              !value ||
                              getFieldValue("newPassword") === value
                            ) {
                              return Promise.resolve();
                            }
                            return Promise.reject(
                              new Error("两次输入不一致")
                            );
                          },
                        }),
                      ]}
                    >
                      <Input.Password placeholder="再次输入新密码" />
                    </Form.Item>

                    <Form.Item>
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
              </Card>
            </div>
          </div>
        </div>
      </motion.div>

      {/* 头像 hover 效果全局样式 */}
      <style>{`
        .avatar-hover-overlay:hover {
          opacity: 1 !important;
        }

        @media (min-width: 1024px) {
          .lg-grid-2cols {
            grid-template-columns: 300px 1fr;
          }
        }
      `}</style>
    </div>
  );
};

export default ProfilePage;
