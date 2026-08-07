import type { Config } from "tailwindcss";

/** Palette from docs/Design.md — disposition colours carry meaning and nowhere else. */
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        page: "#FFFFFF",
        chrome: "#F7F8FA",
        border: "#E2E5EA",
        ink: "#1A1D23",
        mute: "#5A6270",
        faint: "#8A919E",
        accent: "#1F4E79",
        allow: { DEFAULT: "#0F7B3F", soft: "#E8F5EE" },
        deny: { DEFAULT: "#B4242B", soft: "#FCEBEC" },
        escalate: { DEFAULT: "#9A6209", soft: "#FDF3E0" },
        observe: { DEFAULT: "#4A5568", soft: "#EEF1F5" },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-jetbrains)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
