"use client";

import type { CSSProperties } from "react";
import type { ThemeColors } from "@/lib/design-system";
import { borderRadius } from "@/lib/design-system";

/**
 * Floating STOCVEST Assistant launcher. High-contrast accent disc so the affordance
 * is easy to spot on dark dashboards; pulse ring draws the eye without chat-bubble clichés.
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
    width: 60,
    height: 60,
    borderRadius: borderRadius.full,
    background: `linear-gradient(145deg, color-mix(in srgb, ${colors.accent} 42%, #0f172a) 0%, color-mix(in srgb, ${colors.accent} 18%, #1e293b) 100%)`,
    border: `2px solid color-mix(in srgb, ${colors.accent} 75%, white)`,
    boxShadow: open
      ? `0 0 0 3px color-mix(in srgb, ${colors.accent} 35%, transparent), 0 12px 32px rgba(2,6,23,0.55)`
      : `0 0 0 4px color-mix(in srgb, ${colors.accent} 28%, transparent), 0 0 28px color-mix(in srgb, ${colors.accent} 45%, transparent), 0 14px 36px rgba(2,6,23,0.5)`,
    color: "#f8fafc",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "box-shadow 180ms ease, transform 180ms ease"
  };

  return (
    <button
      type="button"
      className="stocvest-assistant-launcher-button"
      aria-label={open ? "Close STOCVEST Assistant" : "Open STOCVEST Assistant"}
      aria-pressed={open}
      onClick={onToggle}
      style={buttonStyle}
    >
      {!open ? <span className="stocvest-assistant-launcher-pulse" aria-hidden /> : null}
      {!open ? <span className="stocvest-assistant-launcher-pulse stocvest-assistant-launcher-pulse--delay" aria-hidden /> : null}
      <LensGlyph />
      {contextDotColor ? (
        <span
          aria-hidden
          style={{
            position: "absolute",
            right: 4,
            bottom: 4,
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
            top: 4,
            right: 4,
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

function LensGlyph() {
  return (
    <svg
      width="26"
      height="26"
      viewBox="0 0 22 22"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <circle cx="11" cy="11" r="8" stroke="#e0f2fe" strokeWidth="1.6" opacity="0.95" />
      <circle cx="11" cy="11" r="4" stroke="#ffffff" strokeWidth="1.2" opacity="0.7" />
      <circle cx="14.2" cy="7.6" r="1.8" fill="#38bdf8" />
    </svg>
  );
}
