import type { Config } from "tailwindcss";
import animate from "tw-animate-css"; // @ts-ignore

export default {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [animate], // 在这里注册插件
} satisfies Config;