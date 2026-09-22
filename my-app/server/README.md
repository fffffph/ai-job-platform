# CareerAI 后端 API 服务

基于 Express + Prisma + PostgreSQL 的后端服务，提供用户认证（注册/登录）等 API。

## 技术栈

| 类别 | 技术 | 用途 |
|------|------|------|
| 框架 | Express 5 | HTTP 服务框架 |
| ORM | Prisma 7 | 数据库操作（类型安全） |
| 数据库 | PostgreSQL | 关系型数据库 |
| 加密 | bcrypt 6 | 密码哈希存储 |
| 认证 | jsonwebtoken 9 | JWT Token 签发与验证 |
| 运行时 | tsx | TypeScript 直接运行（开发） |

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量
# 编辑 .env 文件，设置 PostgreSQL 连接字符串和 JWT 密钥

# 3. 初始化数据库
npm run db:push        # 将 Prisma Schema 同步到数据库
npm run db:seed        # 插入测试用户

# 4. 启动开发服务器
npm run dev            # http://localhost:4000
```

## 目录结构

```
server/
├── prisma/
│   ├── schema.prisma          # 数据库模型定义（User 表）
│   └── seed.ts                # 测试数据种子脚本
├── src/
│   ├── index.ts               # 服务器启动入口
│   ├── app.ts                 # Express 应用配置
│   ├── lib/
│   │   └── prisma.ts         # Prisma 客户端单例
│   ├── routes/
│   │   └── auth.routes.ts    # 认证路由（注册/登录）
│   ├── controllers/
│   │   └── auth.controller.ts # 认证控制器（请求处理）
│   ├── services/
│   │   └── auth.service.ts   # 认证服务（业务逻辑）
│   ├── middleware/
│   │   └── errorHandler.ts   # 全局错误处理
│   └── types/
│       └── index.ts          # TypeScript 类型定义
├── .env                       # 环境变量
├── .gitignore
├── tsconfig.json              # TypeScript 配置
└── package.json
```

## API 文档

### 健康检查
```
GET /api/health
→ { "success": true, "message": "...", "timestamp": "..." }
```

### 用户注册
```
POST /api/auth/register
Body: { "email": "user@example.com", "password": "123456", "name": "张三" }
→ 201 { "success": true, "data": { "token": "...", "user": {...} } }
```

### 用户登录
```
POST /api/auth/login
Body: { "email": "admin@example.com", "password": "123456" }
→ 200 { "success": true, "data": { "token": "...", "user": {...} } }
```

## bcrypt 加密说明

密码使用 bcrypt 进行加盐哈希存储，核心流程：

```
注册：明文 "123456" → bcrypt.hash() → "$2b$10$N9qo8uLOickgx2ZMRZoMye..."（存入数据库）
登录：明文 "123456" → bcrypt.compare(明文, 密文) → true/false
```
