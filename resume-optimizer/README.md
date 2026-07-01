# AI简历优化 - 微前端子应用

基于 qiankun 微前端架构的独立子应用，提供简历上传、AI 分析与优化功能。

## 技术栈

- React 19 + TypeScript
- Vite 6（构建工具，UMD 输出）
- Ant Design 6（UI 组件库）
- Framer Motion（动画效果）
- qiankun（微前端生命周期管理）

## 开发

```bash
# 安装依赖
npm install

# 启动开发服务器（端口 3001）
npm run dev

# 独立访问（非 qiankun 模式）
# 浏览器打开 http://localhost:3001
```

## 构建

```bash
# 构建 UMD 格式产物
npm run build

# 产物输出到 dist/ 目录
# - dist/index.js    — UMD 主入口
# - dist/style.css   — 样式文件
```

## 微前端架构说明

### 作为 qiankun 子应用运行

1. 启动主应用（Next.js）：`cd my-app && npm run dev`
2. 启动子应用（本应用）：`npm run dev`
3. 访问主应用 `http://localhost:3000/dashboard/resume`
4. 主应用通过 `loadMicroApp` 动态加载本子应用

### 生命周期钩子

子应用导出三个 qiankun 标准生命周期函数：
- `bootstrap()` — 初始化（仅执行一次）
- `mount(props)` — 挂载到主应用容器
- `unmount()` — 从主应用卸载

### API 调用

子应用通过主应用的 REST API 获取数据和 AI 分析：
- `POST /api/parse-resume` — 简历文件解析（PDF/DOCX/TXT）
- `POST /api/chat` — AI 简历优化（DeepSeek）
