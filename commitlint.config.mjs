// ============================================================
// commitlint.config.mjs —— 提交信息规范校验
//
// 【为什么只校验 type，不限制 scope】
//   项目历史提交里存在 `refactor, fix, docs: ...` 这类多 type 混写，
//   如果开启 scope-enum 白名单，会高频拦截自己，摩擦成本高于收益。
//   规范的目标是「不让它退化」，不是「一次性改造历史」。
//
// 【允许的 type】
//   feat     新功能
//   fix      修复 bug
//   docs     文档
//   style    格式（不影响逻辑）
//   refactor 重构
//   perf     性能优化
//   test     测试
//   build    构建/依赖
//   ci       CI/CD 配置
//   chore    杂务
//   revert   回滚
// ============================================================

export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // scope 不做白名单限制（0 = 关闭）
    "scope-enum": [0],
    // 标题长度上限 100，中文描述够用且不至于无限长
    "header-max-length": [2, "always", 100],
    // 标题不能为空
    "subject-empty": [2, "never"],
    // 正文行长度不限制（中文段落按行限制会很反人类）
    "body-max-line-length": [0],
    // type 必须小写
    "type-case": [2, "always", "lower-case"],
    // type 不能为空
    "type-empty": [2, "never"],
  },
};
