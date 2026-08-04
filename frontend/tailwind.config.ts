import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: "#ff6b00",
        "on-primary": "#ffffff",
        "primary-container": "#ff6b00",
        "on-primary-container": "#ffffff",
        surface: "#131313",
        "surface-dim": "#131313",
        "surface-bright": "#3a3939",
        "surface-container-lowest": "#0e0e0e",
        "surface-container-low": "#1c1b1b",
        "surface-container": "#201f1f",
        "surface-container-high": "#2a2a2a",
        "surface-container-highest": "#353534",
        "on-surface": "#e5e2e1",
        "on-surface-variant": "#e2bfb0",
        outline: "#a98a7d",
        "outline-variant": "#5a4136",
        "secondary-container": "#474746",
        "on-secondary-container": "#b7b5b4",
        error: "#ffb4ab",
        "error-container": "#93000a",
        "on-error-container": "#ffdad6",
      },
      borderRadius: {
        DEFAULT: "9999px",
        lg: "9999px",
        xl: "9999px",
        "2xl": "2rem",
        full: "9999px",
      },
      fontFamily: {
        display: ["Plus Jakarta Sans", "Noto Sans Arabic", "sans-serif"],
        body: ["Plus Jakarta Sans", "Noto Sans Arabic", "sans-serif"],
        sans: ["Plus Jakarta Sans", "Noto Sans Arabic", "sans-serif"],
      },
      animation: {
        "slide-in-right": "slideInRight 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards",
        "slide-in-left": "slideInLeft 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards",
        "fade-in": "fadeIn 0.3s ease-out forwards",
        "scale-in": "scaleIn 0.2s ease-out forwards",
      },
      keyframes: {
        slideInRight: {
          from: { transform: "translateX(100%)" },
          to: { transform: "translateX(0)" },
        },
        slideInLeft: {
          from: { transform: "translateX(-100%)" },
          to: { transform: "translateX(0)" },
        },
        fadeIn: {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        scaleIn: {
          from: { transform: "scale(0.95)", opacity: "0" },
          to: { transform: "scale(1)", opacity: "1" },
        },
      },
      boxShadow: {
        "hi-fi": "0 20px 40px -15px rgba(0, 0, 0, 0.5)",
        "primary-glow": "0 12px 24px rgba(255, 107, 0, 0.25)",
        "inner-glow": "inset 0 0 20px rgba(255, 107, 0, 0.05)",
      },
    },
  },
  plugins: [],
};

export default config;
