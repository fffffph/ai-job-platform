// ============================================================
// my-app/server/eslint.config.mjs —— 后端（Express 5 + Prisma）ESLint 配置
//
// 【为什么后端最需要 lint 却一直没有】
//   这是一个"前端同学写后端"的项目，最容易出的不是语法错误，
//   而是**异步错误被静默吞掉**：
//
//     router.get("/x", async (req, res) => {
//       const data = await fetchSomething();   // 忘了 try/catch
//       res.json(data);
//     });
//
//   Express 5 虽然会自动捕获 rejected promise，但大量
//   "调用异步函数却没 await" 的场景（比如写审计日志、发通知）
//   失败时不会有任何提示 —— 这类 bug 只能靠 no-floating-promises 抓。
//
// 【规则策略：recommended + 精选 type-aware，而非全量 type-checked】
//   recommendedTypeChecked 会启用 no-unsafe-* 系列，配合本项目
//   21 处显式 any，会瞬间产生几十条 error，噪声淹没真问题。
//   所以只开 3 条"真的会导致线上事故"的类型规则，其余用基础集。
//
// 【代价】
//   type-aware 规则需要 TypeScript 类型信息，ESLint 会构建完整
//   TS Program，lint 会明显变慢。实测见 pre-push 耗时，
//   所以它只在 pre-push 跑，不进 pre-commit。
// ============================================================

import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // ---------- 忽略项 ----------
  {
    ignores: ["dist/**", "node_modules/**", "uploads/**", "*.log"],
  },

  // ---------- 基础规则 ----------
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // ---------- 源码：Node 环境 + 类型感知 ----------
  {
    files: ["src/**/*.ts", "prisma/**/*.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node,
      },
      parserOptions: {
        // projectService：让 typescript-eslint 用 tsconfig 里的项目配置
        // 自动为每个文件找到对应的 TS Program（比手动指定 project 更省事，
        // 也避免 "file not included in project" 报错）
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // ---- 三条真正防事故的类型规则 ----
      // 1. 调用返回 Promise 的函数却没有 await / catch / return
      //    → 异步失败被静默吞掉，日志里什么都看不到
      "@typescript-eslint/no-floating-promises": "error",
      // 2. 把 async 函数直接当回调传给不接受 Promise 的 API
      //    （Express 路由处理器、setTimeout 等）
      "@typescript-eslint/no-misused-promises": "error",
      // 3. await 一个不是 Promise 的值 → 通常意味着忘了调用函数
      "@typescript-eslint/await-thenable": "error",

      // ---- 与前端保持一致的务实调整 ----
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      // Prisma 的 JSON 字段、第三方 SDK 返回值常常只能 any，
      // 降为 warn：看得见但不阻断提交
      "@typescript-eslint/no-explicit-any": "warn",
      // 空接口在 Express 的类型扩展里是常态写法
      "@typescript-eslint/no-empty-object-type": "warn",

      // ---- 存量技术债：先降级为 warn，不要一上线就堵死推送 ----
      //
      // 首次接入时后端有 24 个 error，三处来源：
      //   no-unused-vars        9 处（未使用的变量/导入）
      //   preserve-caught-error 8 处（catch 后 throw 新错误没带 cause）
      //   no-useless-assignment 7 处（赋值了但后续没读）
      //
      // 这些都是「无害但该清理」的问题，不是线上事故隐患。
      // 若保持 error，每次推送后端都会被这 24 处拦住，
      // 结果必然是所有人都学会 --no-verify —— 钩子等于废掉。
      //
      // 因此策略是：**先以 warn 暴露、逐步清完，再升回 error**。
      // 真正会导致事故的三条规则（no-floating-promises /
      // no-misused-promises / await-thenable）保持 error 不放水。
      "no-useless-assignment": "warn",
      "preserve-caught-error": "warn",
    },
  },
);
