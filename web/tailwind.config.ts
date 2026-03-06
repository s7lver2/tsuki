import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "#060608",
        surface: "#0e0e12",
        surface2: "#16161c",
        border: "rgba(255,255,255,0.07)",
        accent: "#00e5b0",
        "accent-dim": "rgba(0,229,176,0.12)",
        "accent-2": "#5b8fff",
        muted: "#55556a",
        "text-primary": "#eeeef4",
        "text-secondary": "#888899",
      },
      fontFamily: {
        sans: ["var(--font-syne)", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"],
        body: ["var(--font-body)", "sans-serif"],
      },
    },
  },
  plugins: [],
};
export default config;
