/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: "var(--color-brand-primary)",
          muted: "var(--color-brand-muted)",
          accent: "var(--color-brand-accent)",
        },
        surface: {
          base: "var(--color-surface-base)",
          card: "var(--color-surface-card)",
        },
      },
      fontFamily: {
        sans: ["'SF Pro Display'", "Inter", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "0 20px 40px rgba(15, 23, 42, 0.08)",
      },
      borderRadius: {
        xl: "var(--radius-xl)",
        "2xl": "var(--radius-2xl)",
      },
    },
  },
  plugins: [],
};
