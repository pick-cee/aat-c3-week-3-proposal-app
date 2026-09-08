import type { Config } from "tailwindcss";

/**
 * Tokens are defined once in globals.css and surfaced here, so a colour can
 * never drift between a CSS rule and a utility class.
 */
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: {
          sunken: "hsl(var(--surface-sunken))",
          DEFAULT: "hsl(var(--surface))",
          raised: "hsl(var(--surface-raised))",
        },
        ink: {
          DEFAULT: "hsl(var(--ink))",
          muted: "hsl(var(--ink-muted))",
          subtle: "hsl(var(--ink-subtle))",
          inverse: "hsl(var(--ink-inverse))",
        },
        line: {
          DEFAULT: "hsl(var(--line))",
          strong: "hsl(var(--line-strong))",
        },
        state: {
          draft: "hsl(var(--state-draft))",
          "draft-fill": "hsl(var(--state-draft-fill))",
          review: "hsl(var(--state-review))",
          "review-fill": "hsl(var(--state-review-fill))",
          changes: "hsl(var(--state-changes))",
          "changes-fill": "hsl(var(--state-changes-fill))",
          approved: "hsl(var(--state-approved))",
          "approved-fill": "hsl(var(--state-approved-fill))",
          sent: "hsl(var(--state-sent))",
          "sent-fill": "hsl(var(--state-sent-fill))",
          failed: "hsl(var(--state-failed))",
          "failed-fill": "hsl(var(--state-failed-fill))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          hover: "hsl(var(--accent-hover))",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        serif: ["var(--font-serif)", "Georgia", "serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      fontSize: {
        // A real scale rather than Tailwind's defaults, with line heights and
        // tracking set per step. Headings tighten as they grow.
        "2xs": ["0.6875rem", { lineHeight: "1rem", letterSpacing: "0.02em" }],
        xs: ["0.75rem", { lineHeight: "1.125rem" }],
        sm: ["0.8125rem", { lineHeight: "1.25rem" }],
        base: ["0.875rem", { lineHeight: "1.5rem" }],
        lg: ["1rem", { lineHeight: "1.625rem" }],
        xl: ["1.125rem", { lineHeight: "1.75rem", letterSpacing: "-0.01em" }],
        "2xl": ["1.375rem", { lineHeight: "1.875rem", letterSpacing: "-0.015em" }],
        "3xl": ["1.75rem", { lineHeight: "2.125rem", letterSpacing: "-0.02em" }],
        "4xl": ["2.25rem", { lineHeight: "2.5rem", letterSpacing: "-0.025em" }],
        "5xl": ["3rem", { lineHeight: "3.25rem", letterSpacing: "-0.03em" }],
      },
      borderRadius: {
        DEFAULT: "var(--radius)",
        sm: "var(--radius-sm)",
        lg: "var(--radius-lg)",
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        DEFAULT: "var(--shadow)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
      },
      maxWidth: {
        // The reading measure for the client document.
        prose: "38rem",
      },
    },
  },
  plugins: [],
} satisfies Config;
