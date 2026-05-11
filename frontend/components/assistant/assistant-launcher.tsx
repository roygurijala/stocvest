"use client";

import type { CSSProperties } from "react";
import type { ThemeColors } from "@/lib/design-system";
import { borderRadius } from "@/lib/design-system";

/**
 * Floating STOCVEST Assistant launcher. Deliberately not a chat bubble:
 * a custom lens glyph (concentric ring with an offset dot) sits inside a
 * glass disc, and a slow pulse ring breathes behind it so the affordance
 * reads as "ambient companion" rather than "ping for attention".
 */
interface AssistantLauncherProps {
  open: boolean;
  onToggle: () => void;
  colors: ThemeColors;
  /** Soft tone hint that reflects the active page's Decision state, when contextual. */
  contextDotColor?: string;
  /** Renders a tiny new-message indicator when the assistant has spoken and the panel is closed. */
  hasUnread?: boolean;
}

export function AssistantLauncher({
  open,
  onToggle,
  colors,
  contextDotColor,
  hasUnread
}: AssistantLauncherProps) {
  const buttonStyle: CSSProperties = {
    position: "relative",
    width: 56,
    height: 56,
    borderRadius: borderRadius.full,
    background: `radial-gradient(circle at 30% 30%, ${colors.surface} 0%, ${colors.surfaceMuted} 100%)`,
    border: `1px solid ${colors.border}`,
    boxShadow:
      "0 10px 30px rgba(2,6,23,0.45), inset 0 1px 0 rgba(255,255,255,0.05), 0 0 0 1px rgba(56,189,248,0.18)",
    color: colors.text,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    backdropFilter: "blur(10px)"
  };

  return (
    <button
      type="button"
      aria-label={open ? "Close STOCVEST Assistant" : "Open STOCVEST Assistant"}
      aria-pressed={open}
      onClick={onToggle}
      style={buttonStyle}
    >
      {!open ? <span className="stocvest-assistant-launcher-pulse" aria-hidden /> : null}
      <LensGlyph colors={colors} />
      {contextDotColor ? (
        <span
          aria-hidden
          style={{
            position: "absolute",
            right: 6,
            bottom: 6,
            width: 8,
            height: 8,
            borderRadius: borderRadius.full,
            background: contextDotColor,
            boxShadow: `0 0 0 2px ${colors.surface}`
          }}
        />
      ) : null}
      {hasUnread ? (
        <span
          aria-hidden
          style={{
            position: "absolute",
            top: 6,
            right: 6,
            width: 8,
            height: 8,
            borderRadius: borderRadius.full,
            background: colors.accent,
            boxShadow: `0 0 0 2px ${colors.surface}`
          }}
        />
      ) : null}
    </button>
  );
}

function LensGlyph({ colors }: { colors: ThemeColors }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 22 22"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <circle cx="11" cy="11" r="8" stroke={colors.accent} strokeWidth="1.4" opacity="0.85" />
      <circle cx="11" cy="11" r="4" stroke={colors.text} strokeWidth="1.1" opacity="0.55" />
      <circle cx="14.2" cy="7.6" r="1.6" fill={colors.accent} />
    </svg>
  );
}
