import type { CSSProperties } from "react";
import type { CardRole, ThemeName } from "@/lib/design-system";
import { roleAccents } from "@/lib/design-system";
import type { ThemeColors } from "@/lib/design-system";
import type { ScannerMode, TradingMode } from "@/lib/mode-terminology";

export type DeskModeTabKey = TradingMode | ScannerMode;

export function deskModeToCardRole(mode: DeskModeTabKey): CardRole {
  if (mode === "day") return "day";
  if (mode === "swing") return "swing";
  return "shared";
}

export function deskModeCadenceLabel(mode: DeskModeTabKey): string | null {
  if (mode === "swing") return "Multi-day";
  if (mode === "day") return "Intraday";
  if (mode === "both") return "Swing + Day";
  return null;
}

export type DeskModeTabPresentation = {
  railHue: string;
  accentStrong: string;
  tabStyle: CSSProperties;
  cadenceStyle: CSSProperties;
};

/** High-contrast swing / day / both tab chrome (shared across dashboard, watchlist, signals, scanner). */
export function getDeskModeTabPresentation(
  theme: ThemeName,
  mode: DeskModeTabKey,
  active: boolean,
  colors: ThemeColors
): DeskModeTabPresentation {
  const role = deskModeToCardRole(mode);
  const accent = roleAccents[theme][role];
  const railHue = accent.borderAccent;

  return {
    railHue,
    accentStrong: accent.accentStrong,
    tabStyle: {
      position: "relative",
      display: "inline-flex",
      flexDirection: "column",
      alignItems: "flex-start",
      justifyContent: "center",
      gap: 2,
      minHeight: 40,
      minWidth: 88,
      padding: "8px 14px",
      borderRadius: 8,
      border: `${active ? 2 : 1}px solid ${
        active ? railHue : `color-mix(in srgb, ${railHue} 42%, ${colors.border})`
      }`,
      background: active
        ? `color-mix(in srgb, ${railHue} 22%, ${colors.surface})`
        : `color-mix(in srgb, ${railHue} 10%, ${colors.surfaceMuted})`,
      color: active ? accent.accentStrong : colors.text,
      fontWeight: active ? 700 : 600,
      cursor: "pointer",
      boxShadow: active ? `0 0 0 1px color-mix(in srgb, ${railHue} 35%, transparent)` : "none",
      transition: "background 120ms ease, border-color 120ms ease, box-shadow 120ms ease"
    },
    cadenceStyle: {
      fontSize: 10,
      fontWeight: 600,
      letterSpacing: "0.05em",
      textTransform: "uppercase",
      lineHeight: 1.1,
      color: active ? railHue : `color-mix(in srgb, ${railHue} 55%, ${colors.textMuted})`
    }
  };
}
