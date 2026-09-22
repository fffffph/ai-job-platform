/**
 * ============================================
 * 职位数据源（Mock 模拟数据）
 * ============================================
 *
 * 【职责】
 * 为职位发现 Agent 提供可搜索的职位数据。当前为**模拟数据**，
 * 覆盖前端开发常见岗位（以西安为主，兼顾一线城市），字段贴近真实招聘信息。
 *
 * 【为什么用 Mock 而不是真实抓取？】
 * 真实抓取 Boss直聘/拉勾/猎聘涉及反爬（登录态、验证码、IP 封禁）与
 * 平台 ToS 合规风险。按架构设计约定，P4 先用模拟数据跑通 Agent 的
 * 「自主规划」能力（决定搜什么、搜几轮、如何推荐），真实抓取后续
 * 通过替换 searchJobs 的实现接入（source 字段已预留）。
 *
 * 【数据字段说明】
 * - id           : 职位唯一标识
 * - title        : 职位名称
 * - company      : 公司名
 * - city         : 城市
 * - salary       : 薪资范围（字符串，如 "12k-18k"）
 * - source       : 数据来源标识（boss / lagou / liepin）
 * - tags         : 技术栈标签（用于关键词匹配）
 * - requirements : 岗位要求简述（用于 Agent 判断匹配度）
 */

/** 单条职位数据 */
export interface JobPosting {
  id: string;
  title: string;
  company: string;
  city: string;
  salary: string;
  source: string;
  tags: string[];
  requirements: string;
  /** BOSS直聘直达搜索链接（点击跳转到真实职位搜索页，可直接投递） */
  url: string;
}

/**
 * BOSS直聘 web 端城市代码映射（city 参数）。
 * 用于把 mock 职位所在的城市转成 BOSS直聘搜索 URL 的城市代码，
 * 让直达链接精准定位到对应城市。
 */
const BOSS_CITY_CODES: Record<string, string> = {
  西安: "101110100",
  北京: "101010100",
  上海: "101020100",
  广州: "101280100",
  深圳: "101280600",
  杭州: "101210100",
  成都: "101270100",
  南京: "101190100",
  武汉: "101200100",
};

/**
 * 构造 BOSS直聘职位搜索直达链接。
 *
 * 用职位名作为搜索关键词、城市代码限定地域，生成公开搜索页 URL。
 * 用户点击后在已登录的 BOSS直聘里看到真实职位，可直接沟通投递。
 * 这是「不抓取数据、只给链接」的合规直达方案。
 *
 * @param title - 职位名（作为搜索关键词）
 * @param city  - 城市（映射为城市代码）
 * @returns BOSS直聘搜索页 URL
 */
export function buildBossUrl(title: string, city: string): string {
  const cityCode = BOSS_CITY_CODES[city] ?? "";
  const params = new URLSearchParams();
  params.set("query", title);
  if (cityCode) params.set("city", cityCode);
  return `https://www.zhipin.com/web/geek/job?${params.toString()}`;
}

/** 模拟职位库原始数据（不含 url，url 由 MOCK_JOBS 统一生成） */
const RAW_JOBS: Omit<JobPosting, "url">[] = [
  {
    id: "job-001",
    title: "高级前端工程师",
    company: "西安云创科技",
    city: "西安",
    salary: "12k-18k",
    source: "boss",
    tags: ["React", "TypeScript", "qiankun", "微前端"],
    requirements: "5年以上前端经验，熟悉 React 生态、微前端架构，有大型项目经验",
  },
  {
    id: "job-002",
    title: "前端开发工程师",
    company: "西安智联信息",
    city: "西安",
    salary: "10k-15k",
    source: "boss",
    tags: ["Vue", "Vite", "Element Plus"],
    requirements: "3年以上经验，熟练 Vue3 + Vite，有中后台项目经验",
  },
  {
    id: "job-003",
    title: "React 前端工程师",
    company: "陕西融媒体技术",
    city: "西安",
    salary: "11k-16k",
    source: "lagou",
    tags: ["React", "UEditor", "wangEditor", "富文本"],
    requirements: "熟悉 React + 富文本编辑器二次开发，有媒体行业经验优先",
  },
  {
    id: "job-004",
    title: "前端开发（微前端方向）",
    company: "西安数字引擎",
    city: "西安",
    salary: "13k-20k",
    source: "boss",
    tags: ["React", "qiankun", "微前端", "Node.js"],
    requirements: "熟悉微前端架构设计与落地，掌握 Node.js 中间层开发",
  },
  {
    id: "job-005",
    title: "React Native 开发工程师",
    company: "西安移联科技",
    city: "西安",
    salary: "12k-18k",
    source: "lagou",
    tags: ["React Native", "TypeScript", "移动端"],
    requirements: "3年以上 RN 经验，有上架 App 经验，熟悉原生桥接",
  },
  {
    id: "job-006",
    title: "小程序开发工程师",
    company: "西安轻联网络",
    city: "西安",
    salary: "9k-14k",
    source: "boss",
    tags: ["Taro", "小程序", "React"],
    requirements: "熟悉 Taro + React 开发多端小程序，有电商类项目经验",
  },
  {
    id: "job-007",
    title: "全栈开发工程师",
    company: "西安启智科技",
    city: "西安",
    salary: "14k-22k",
    source: "liepin",
    tags: ["Node.js", "React", "PostgreSQL", "全栈"],
    requirements: "前后端全栈，Node.js + React，熟悉数据库设计",
  },
  {
    id: "job-008",
    title: "前端架构师",
    company: "西安鼎力软件",
    city: "西安",
    salary: "20k-30k",
    source: "liepin",
    tags: ["架构", "微前端", "性能优化", "工程化"],
    requirements: "8年以上经验，主导过大型前端架构设计，精通性能优化与工程化",
  },
  {
    id: "job-009",
    title: "高级前端工程师（AI 方向）",
    company: "西安星辰智能",
    city: "西安",
    salary: "15k-25k",
    source: "boss",
    tags: ["React", "AI", "大模型", "LLM"],
    requirements: "熟悉 AI 应用开发，有接入大模型 API、构建 AI 产品的经验",
  },
  {
    id: "job-010",
    title: "前端开发工程师",
    company: "西安聚客电商",
    city: "西安",
    salary: "8k-12k",
    source: "boss",
    tags: ["Vue", "电商", "Element Plus"],
    requirements: "2年以上 Vue 经验，有电商后台或移动端项目经验",
  },
  {
    id: "job-011",
    title: "前端开发（可视化方向）",
    company: "西安数图科技",
    city: "西安",
    salary: "12k-17k",
    source: "lagou",
    tags: ["ECharts", "React", "数据可视化", "大屏"],
    requirements: "熟悉 ECharts 与数据可视化大屏开发，有 React 经验",
  },
  {
    id: "job-012",
    title: "高级前端工程师",
    company: "杭州云栖科技",
    city: "杭州",
    salary: "20k-35k",
    source: "boss",
    tags: ["React", "TypeScript", "微前端"],
    requirements: "5年以上经验，React 生态精通，有微前端或大型中台经验",
  },
  {
    id: "job-013",
    title: "前端开发工程师",
    company: "北京字节跳动",
    city: "北京",
    salary: "30k-50k",
    source: "boss",
    tags: ["React", "TypeScript", "性能优化"],
    requirements: "3年以上经验，算法基础扎实，有高性能前端经验",
  },
  {
    id: "job-014",
    title: "前端工程师（国际化）",
    company: "深圳腾讯",
    city: "深圳",
    salary: "25k-40k",
    source: "boss",
    tags: ["React", "TypeScript", "Node.js"],
    requirements: "熟悉 React + Node.js，有国际化或大型团队协作经验",
  },
  {
    id: "job-015",
    title: "React 前端工程师",
    company: "西安蓝鲸互动",
    city: "西安",
    salary: "10k-15k",
    source: "lagou",
    tags: ["React", "Ant Design", "后台管理系统"],
    requirements: "3年以上 React + Antd 经验，擅长后台管理系统开发",
  },
  {
    id: "job-016",
    title: "前端开发（H5 方向）",
    company: "西安新媒在线",
    city: "西安",
    salary: "9k-13k",
    source: "boss",
    tags: ["H5", "Vue", "wangEditor", "融媒体"],
    requirements: "熟悉移动端 H5 开发，有融媒体或内容平台经验优先",
  },
  {
    id: "job-017",
    title: "高级前端工程师（Node.js）",
    company: "西安云枢科技",
    city: "西安",
    salary: "13k-19k",
    source: "liepin",
    tags: ["React", "Node.js", "Express", "BFF"],
    requirements: "熟悉 React + Node.js BFF 层开发，有全栈能力",
  },
  {
    id: "job-018",
    title: "前端开发工程师",
    company: "西安智行汽车",
    city: "西安",
    salary: "10k-15k",
    source: "boss",
    tags: ["Vue", "uni-app", "跨端"],
    requirements: "熟悉 uni-app 或 Taro 跨端开发，有车企或工具类 App 经验",
  },
  {
    id: "job-019",
    title: "前端开发（低代码方向）",
    company: "西安矩阵软件",
    city: "西安",
    salary: "12k-18k",
    source: "lagou",
    tags: ["React", "低代码", "拖拽", "Schema"],
    requirements: "熟悉低代码平台搭建，React + JSON Schema 表单渲染",
  },
  {
    id: "job-020",
    title: "资深前端工程师",
    company: "成都天府软件园某司",
    city: "成都",
    salary: "18k-28k",
    source: "boss",
    tags: ["React", "TypeScript", "性能优化", "工程化"],
    requirements: "6年以上经验，React 生态 + 工程化 + 性能优化，可带团队",
  },
  {
    id: "job-021",
    title: "前端开发工程师",
    company: "西安优创网络",
    city: "西安",
    salary: "8k-12k",
    source: "boss",
    tags: ["JavaScript", "Vue", "CSS"],
    requirements: "2年以上经验，扎实的 JS/CSS 基础，熟悉 Vue",
  },
  {
    id: "job-022",
    title: "Web 前端开发工程师",
    company: "西安慧眼数据",
    city: "西安",
    salary: "11k-16k",
    source: "lagou",
    tags: ["React", "ECharts", "数据平台"],
    requirements: "熟悉 React + ECharts，有数据平台或 BI 项目经验",
  },
  {
    id: "job-023",
    title: "前端开发（AI 应用）",
    company: "北京深度求索",
    city: "北京",
    salary: "35k-60k",
    source: "liepin",
    tags: ["React", "AI", "LLM", "流式"],
    requirements: "熟悉大模型应用开发，有流式交互、Agent 编排经验优先",
  },
  {
    id: "job-024",
    title: "前端工程师（容器化）",
    company: "西安云帆科技",
    city: "西安",
    salary: "12k-18k",
    source: "boss",
    tags: ["React", "Docker", "Nginx", "部署"],
    requirements: "熟悉 React + Docker 容器化部署，了解 Nginx 反向代理",
  },
];

/**
 * 模拟职位库（约 24 条，西安为主），每条附带 BOSS直聘直达链接。
 * 由 RAW_JOBS 统一补充 url 字段生成，避免手写 24 个链接。
 */
export const MOCK_JOBS: JobPosting[] = RAW_JOBS.map((job) => ({
  ...job,
  url: buildBossUrl(job.title, job.city),
}));

/**
 * 按关键词与城市搜索职位。
 *
 * 匹配规则（宽松，模拟真实搜索行为）：
 * 1. 关键词命中职位标题、公司名、技术标签、岗位要求中的任意一处；
 * 2. 若指定城市，则仅返回该城市的职位；
 * 3. 无关键词时返回全部（或指定城市的全部）。
 *
 * @param keywords - 搜索关键词（空格分隔多个，任一命中即算匹配）
 * @param city     - 城市过滤（可选）
 * @param source   - 数据来源过滤（可选，预留真实抓取时使用）
 * @param limit    - 最多返回条数（默认 10）
 * @returns 匹配的职位列表（JSON 字符串，供 Agent 阅读）
 */
export function searchJobs(
  keywords: string,
  city?: string,
  source?: string,
  limit = 10
): string {
  // 归一化：关键词拆成数组，去掉空白项
  const kws = (keywords ?? "")
    .toLowerCase()
    .split(/[\s,，、]+/)
    .filter((k) => k.length > 0);

  const results = MOCK_JOBS.filter((job) => {
    // 城市过滤（不区分大小写）
    if (city && job.city !== city.trim()) {
      return false;
    }
    // 来源过滤
    if (source && job.source !== source.trim().toLowerCase()) {
      return false;
    }
    // 无关键词 → 全匹配
    if (kws.length === 0) {
      return true;
    }
    // 关键词命中标题/公司/标签/要求
    const haystack = [
      job.title,
      job.company,
      job.tags.join(" "),
      job.requirements,
    ]
      .join(" ")
      .toLowerCase();
    return kws.some((kw) => haystack.includes(kw));
  });

  // 截断到 limit，返回 JSON 字符串（Agent 工具的标准返回格式）
  const sliced = results.slice(0, limit);
  return JSON.stringify(
    {
      count: sliced.length,
      jobs: sliced,
    },
    null,
    2
  );
}
