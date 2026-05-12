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

/**
 * Role-coded color language for dashboard surfaces — Mode Separation B28.
 *
 * Three orthogonal channels of meaning the user has to read on the dashboard:
 *  1. PRICE DIRECTION — green/red — already locked to `colors.bullish` / `colors.bearish`.
 *  2. CAUTION / WARNING — amber — already locked to `colors.caution`.
 *  3. DESK ROLE — slate / indigo / teal — introduced here.
 *
 * The three role accents MUST NOT overlap with channels 1 or 2. They live in their own
 * hue families (slate-blue, indigo, teal) so a user can answer "is this a swing card, a
 * day card, or shared context?" by hue ALONE without reading copy. Numbers and arrows
 * keep their P/L green/red semantics — color encodes role, not signal strength or market
 * direction.
 *
 * Layered onto `surface` via `color-mix(in srgb, <role.accent> N%, <surface>)`. Card
 * components apply the tint to the surface gradient + left-edge stripe + pill. Numeric
 * cells (percent changes, scores) read from `colors.bullish` / `colors.bearish` /
 * `colors.text` as today — those are unchanged.
 */
export type CardRole = "shared" | "swing" | "day";

export interface RoleAccent {
  /** Surface tint — soft hue blended into the card background. Subtle (~9%). */
  accent: string;
  /** Stronger contrast variant for pill text on the muted surface. */
  accentStrong: string;
  /**
   * Border hue — Phase 2b "rail line" treatment. Distinctly BRIGHTER than `accent`
   * so the master-card boundary is visible in peripheral vision without reading
   * any text. The user's directive was explicit: "Borders should be clearly
   * visible even in peripheral vision. Think 'rail lines', not soft shadows."
   *
   *   - shared: electric cyan-steel — pops against slate backgrounds
   *   - swing : bright violet-indigo — pops against deep indigo backgrounds
   *   - day   : bright aqua-cyan    — pops against dark teal backgrounds
   *
   * The border is rendered at 2px solid (vs the legacy 1px) so it reads as a
   * structural rail, not a decorative outline.
   */
  borderAccent: string;
  /** Short uppercase label shown on the role pill. Locked verbatim so screenshots
   *  are self-explanatory and tests can anchor on the exact string. */
  pillLabel: string;
}

export const roleAccents: Record<ThemeName, Record<CardRole, RoleAccent>> = {
  dark: {
    // Shared Context — slate / steel surface, electric cyan-steel rail.
    shared: {
      accent: "#64748b",
      accentStrong: "#cbd5e1",
      borderAccent: "#22d3ee",
      pillLabel: "SHARED CONTEXT"
    },
    // Swing Desk — indigo surface, bright violet rail. Distinct from the global
    // accent blue (#3b82f6) which is reserved for interaction cues.
    swing: {
      accent: "#818cf8",
      accentStrong: "#a5b4fc",
      borderAccent: "#a78bfa",
      pillLabel: "SWING · MULTI-DAY"
    },
    // Day Desk — teal surface, bright aqua rail. Teal (not amber) was chosen so
    // the desk identity does not visually shout "warning" when posture is calm.
    day: {
      accent: "#2dd4bf",
      accentStrong: "#5eead4",
      borderAccent: "#67e8f9",
      pillLabel: "DAY · INTRADAY"
    }
  },
  light: {
    shared: {
      accent: "#475569",
      accentStrong: "#334155",
      borderAccent: "#0891b2",
      pillLabel: "SHARED CONTEXT"
    },
    swing: {
      accent: "#4f46e5",
      accentStrong: "#3730a3",
      borderAccent: "#7c3aed",
      pillLabel: "SWING · MULTI-DAY"
    },
    day: {
      accent: "#0d9488",
      accentStrong: "#115e59",
      borderAccent: "#0e7490",
      pillLabel: "DAY · INTRADAY"
    }
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
