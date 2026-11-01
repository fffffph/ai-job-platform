// ============================================================
// resume-optimizer/eslint.config.mjs —— 子应用（Vite + React 19）ESLint 配置
//
// 【为什么在此之前没有 lint】
//   子应用是从主应用拆出来的 qiankun 微前端，当时只保证"能跑"，
//   没配任何静态检查。P1 阶段补上，与主应用保持"同一代的规则思路"。
//
// 【配置三段构成】
//   1. @eslint/js recommended      —— JS 基础正确性（no-undef / no-unused-vars 等）
//   2. typescript-eslint recommended —— TS 语义规则（no-floating-promises 除外，
//      见下方说明），no-explicit-any 在此套里是 warn，不阻断提交
//   3. eslint-plugin-react-hooks  —— React Hooks 规则 + React Compiler 系列
//      （rules-of-hooks / exhaustive-deps / set-state-in-effect 等 17 条）
//      这一套和主应用 eslint-config-next 里的 react-hooks 同源，
//      因此两个应用的 Hooks 约束口径一致，不会出现"主应用报错、子应用放行"。
//
// 【刻意不做的两件事】
//   · 不开 type-checked 规则集（recommendedTypeChecked）：
//     它会用 no-unsafe-* 系列把 12 处显式 any 放大成几十条 error，
//     噪声远大于收益。需要类型级约束时靠 tsc --noEmit（已在 pre-push）。
//   · 不引入格式化规则（indent/quotes 等）：格式化交给 Prettier 独管，
//     两套工具管同一件事必然互相打架。
// ============================================================

import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // ---------- 忽略项 ----------
  {
    ignores: ["dist/**", "node_modules/**", "*.log"],
  },

  // ---------- 基础规则 ----------
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // ---------- React Hooks（含 React Compiler 规则）----------
  // ⚠️ 不能直接写 reactHooks.configs["recommended-latest"]：
  // 该对象在 ESLint 10 下会被判定为「旧版 eslintrc 格式」而报错
  // （它会带上 plugins 数组等 legacy 字段）。
  // 显式声明 plugins + 展开 rules 是跨版本最稳的写法。
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },

  // ---------- 源码：浏览器环境 ----------
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      // 未使用变量：允许 _ 前缀占位（解构时丢弃字段的常见写法）
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      // qiankun 生命周期挂在 window 上，显式 any 在此处是合理妥协：
      // 降为 warn，保证能看到但不阻断提交
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },

  // ---------- 构建配置：Node 环境 ----------
  {
    files: ["vite.config.ts", "*.config.{js,mjs,ts}"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
);
