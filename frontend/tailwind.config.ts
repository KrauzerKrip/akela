import type { Config } from "tailwindcss";
import forms from "@tailwindcss/forms";

export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "#0a0a0b",
        foreground: "#e4e4e7",
        panel: "#111113",
        panelBorder: "#27272a",
        muted: "#18181b",
        mutedForeground: "#a1a1aa",
        primary: "#2563eb",
        danger: "#dc2626",
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [forms],
} satisfies Config;
