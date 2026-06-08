"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { Sparkles } from "lucide-react";
import type { ThemeColors } from "@/lib/design-system";
import { borderRadius, typography } from "@/lib/design-system";

/**
 * Floating STOCVEST Assistant launcher — a labeled "Ask AI" pill (not a bare
 * disc) so the affordance is self-explanatory and gets used. A single slow pulse
 * ring gently draws the eye; it respects `prefers-reduced-motion`.
 *
 * Three visual treatments are supported for comparison. The default is the
 * on-brand accent fill (recommended). Set `stocvest:assistant-variant` in
 * localStorage to "accent" | "glass" | "white" to preview the others without a
 * code change.
 */
type LauncherVariant = "accent" | "glass" | "white";

const VARIANT_STORAGE_KEY = "stocvest:assistant-variant";

interface AssistantLauncherProps {
  open: boolean;
  onToggle: () => void;
  colors: ThemeColors;
  /** Soft tone hint that reflects the active page's Decision state, when contextual. */
  contextDotColor?: string;
  /** Renders a tiny new-message indicator when the assistant has spoken and the panel is closed. */
  hasUnread?: boolean;
  /** Visual treatment. Defaults to the on-brand accent fill. */
  variant?: LauncherVariant;
  /** Icon-only (no label) — useful on very small screens. */
  compact?: boolean;
}

function launcherPalette(variant: LauncherVariant, colors: ThemeColors) {
  if (variant === "white") {
    return {
      bg: "#ffffff",
      border: "rgba(2,6,23,0.12)",
      fg: "#0f172a",
      icon: colors.accent,
      shadow: "0 10px 28px rgba(2,6,23,0.30)"
    };
  }
  if (variant === "glass") {
    return {
      bg: "rgba(15,23,42,0.72)",
      border: `color-mix(in srgb, ${colors.accent} 60%, transparent)`,
      fg: "#e2e8f0",
      icon: colors.accent,
      shadow: `0 0 0 1px color-mix(in srgb, ${colors.accent} 20%, transparent), 0 12px 32px rgba(2,6,23,0.5)`
    };
  }
  // accent (default, recommended)
  return {
    bg: `linear-gradient(135deg, ${colors.accent}, color-mix(in srgb, ${colors.accent} 68%, #1e3a8a))`,
    border: `color-mix(in srgb, ${colors.accent} 80%, white)`,
    fg: "#f8fafc",
    icon: "#ffffff",
    shadow: `0 0 0 4px color-mix(in srgb, ${colors.accent} 20%, transparent), 0 14px 34px rgba(2,6,23,0.45)`
  };
}

export function AssistantLauncher({
  open,
  onToggle,
  colors,
  contextDotColor,
  hasUnread,
  variant = "accent",
  compact = false
}: AssistantLauncherProps) {
  // Optional localStorage override so the three treatments can be compared
  // without a redeploy. SSR-safe: defaults to the prop until the effect runs.
  const [activeVariant, setActiveVariant] = useState<LauncherVariant>(variant);
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(VARIANT_STORAGE_KEY);
      setActiveVariant(saved === "accent" || saved === "glass" || saved === "white" ? saved : variant);
    } catch {
      setActiveVariant(variant);
    }
  }, [variant]);

  const palette = launcherPalette(activeVariant, colors);
  const showLabel = !compact;

  const buttonStyle: CSSProperties = {
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: showLabel ? 8 : 0,
    height: 48,
    width: showLabel ? undefined : 48,
    padding: showLabel ? "0 18px 0 15px" : 0,
    borderRadius: borderRadius.full,
    background: palette.bg,
    border: `1px solid ${palette.border}`,
    color: palette.fg,
    fontSize: typography.scale.sm,
    fontWeight: 700,
    letterSpacing: "0.02em",
    cursor: "pointer",
    boxShadow: palette.shadow,
    transition: "box-shadow 180ms ease, transform 180ms ease, background 180ms ease"
  };

  return (
    <button
      type="button"
      className="stocvest-assistant-launcher-button stocvest-assistant-launcher-pill"
      data-variant={activeVariant}
      aria-label={open ? "Close STOCVEST Assistant" : "Ask the STOCVEST Assistant"}
      aria-pressed={open}
      onClick={onToggle}
      style={buttonStyle}
    >
      {!open ? <span className="stocvest-assistant-launcher-pulse" aria-hidden /> : null}
      <Sparkles size={18} aria-hidden style={{ flex: "none", color: palette.icon }} />
      {showLabel ? (
        <span style={{ whiteSpace: "nowrap", position: "relative" }}>{open ? "Close" : "Ask AI"}</span>
      ) : null}
      {contextDotColor ? (
        <span
          aria-hidden
          style={{
            position: "absolute",
            right: -2,
            bottom: -2,
            width: 10,
            height: 10,
            borderRadius: borderRadius.full,
            background: contextDotColor,
            boxShadow: `0 0 0 2px #0f172a, 0 0 8px ${contextDotColor}`
          }}
        />
      ) : null}
      {hasUnread ? (
        <span
          aria-hidden
          style={{
            position: "absolute",
            top: -3,
            right: -3,
            width: 10,
            height: 10,
            borderRadius: borderRadius.full,
            background: "#fbbf24",
            boxShadow: "0 0 0 2px #0f172a"
          }}
        />
      ) : null}
    </button>
  );
}
