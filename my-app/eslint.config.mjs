import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // server/ 是独立的 Express 后端项目（自己的 tsconfig 与 eslint 配置），
    // 物理位置虽然在 my-app 目录内，但与 Next 应用无关。
    // my-app/tsconfig.json 的 exclude 里本来就有 server，此处与之对齐。
    // 不忽略的后果：Next 的规则集（含 React Compiler 规则）会去分析后端代码，
    // 既报错得莫名其妙，又让 lint 耗时从 6s 涨到近 60s。
    "server/**",
  ]),
]);

export default eslintConfig;
