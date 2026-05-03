export type ThemeName = "dark" | "light";

export interface ThemeColors {
  background: string;
  surface: string;
  surfaceMuted: string;
  text: string;
  textMuted: string;
  border: string;
  accent: string;
  bullish: string;
  bearish: string;
  caution: string;
}

export const colorTokens: Record<ThemeName, ThemeColors> = {
  dark: {
    background: "#0a0e1a",
    surface: "#10172b",
    surfaceMuted: "#17223d",
    text: "#f8fafc",
    textMuted: "#94a3b8",
    border: "#1e293b",
    accent: "#3b82f6",
    bullish: "#22c55e",
    bearish: "#ef4444",
    caution: "#f59e0b"
  },
  light: {
    background: "#f8fafc",
    surface: "#ffffff",
    surfaceMuted: "#e2e8f0",
    text: "#0f172a",
    textMuted: "#475569",
    border: "#cbd5e1",
    accent: "#2563eb",
    bullish: "#16a34a",
    bearish: "#dc2626",
    caution: "#d97706"
  }
};

export const typography = {
  fontFamilySans: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif",
  fontFamilyMono: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace",
  scale: {
    xs: "0.75rem",
    sm: "0.875rem",
    base: "1rem",
    lg: "1.125rem",
    xl: "1.25rem",
    "2xl": "1.5rem",
    "3xl": "1.875rem",
    "4xl": "2.25rem"
  },
  lineHeight: {
    tight: 1.2,
    normal: 1.5,
    relaxed: 1.7
  }
} as const;

export const spacing = {
  0: "0",
  1: "0.25rem",
  2: "0.5rem",
  3: "0.75rem",
  4: "1rem",
  5: "1.25rem",
  6: "1.5rem",
  8: "2rem",
  10: "2.5rem",
  12: "3rem",
  16: "4rem",
  20: "5rem"
} as const;

export const borderRadius = {
  none: "0",
  sm: "0.25rem",
  md: "0.5rem",
  lg: "0.75rem",
  xl: "1rem",
  "2xl": "1.5rem",
  full: "9999px"
} as const;

export const shadows = {
  sm: "0 1px 2px rgba(0, 0, 0, 0.08)",
  md: "0 6px 20px rgba(0, 0, 0, 0.2)",
  lg: "0 12px 32px rgba(0, 0, 0, 0.28)",
  xl: "0 22px 56px rgba(0, 0, 0, 0.34)"
} as const;

export const animationDurations = {
  instant: 80,
  fast: 150,
  normal: 240,
  slow: 360
} as const;

/** Accent outer glow for panels; paired styles in `app/globals.css` (`.theme-dark` / `.theme-light`). */
export const surfaceGlowClassName = "stocvest-glow-surface";
