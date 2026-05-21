"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { useTheme } from "@/lib/theme-provider";

export type StocvestLogoVariant = "full" | "compact" | "mark";

type Props = {
  variant?: StocvestLogoVariant;
  /** Product tagline — best on auth / marketing, not sidebar. */
  showTagline?: boolean;
  href?: string;
  className?: string;
  style?: CSSProperties;
};

/**
 * Theme-aware STOCVEST mark + wordmark (SVG).
 * Monogram uses a cool silver gradient with a hint of desk accent blue.
 */
function LogoMark({ size = 40 }: { size?: number }) {
  const { colors, theme } = useTheme();
  const gradId = "stocvest-mark-grad";
  const markFrom = theme === "dark" ? "#e2e8f0" : "#334155";
  const markTo = theme === "dark" ? "#94a3b8" : "#64748b";
  const accentHint = colors.accent;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      className="shrink-0"
    >
      <defs>
        <linearGradient id={gradId} x1="8" y1="10" x2="40" y2="38" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={markFrom} />
          <stop offset="55%" stopColor={markTo} />
          <stop offset="100%" stopColor={accentHint} stopOpacity={0.85} />
        </linearGradient>
      </defs>
      {/* S — stacked horizontals with vertical stem gap (matches brand lockup) */}
      <path
        d="M8 14h14M8 22h11M8 30h8"
        stroke={`url(#${gradId})`}
        strokeWidth="3.2"
        strokeLinecap="square"
      />
      <path d="M22 14v16" stroke={`url(#${gradId})`} strokeWidth="3.2" strokeLinecap="square" />
      {/* V — sharp, separated from S */}
      <path
        d="M28 14L36 34L44 14"
        stroke={`url(#${gradId})`}
        strokeWidth="3.2"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
    </svg>
  );
}

function LogoWordmark({ compact = false }: { compact?: boolean }) {
  const { colors } = useTheme();
  return (
    <span
      className="font-semibold uppercase leading-none"
      style={{
        color: colors.text,
        fontSize: compact ? "0.95rem" : "1.125rem",
        letterSpacing: compact ? "0.22em" : "0.28em"
      }}
    >
      STOCVEST
    </span>
  );
}

function LogoTagline() {
  const { colors } = useTheme();
  return (
    <span
      className="mt-2 block max-w-[16rem] text-center text-[9px] font-medium uppercase leading-snug tracking-[0.12em] sm:text-[10px]"
      style={{ color: colors.textMuted }}
    >
      Judgment · Restraint · Gating · Permission
    </span>
  );
}

export function StocvestLogo({
  variant = "compact",
  showTagline = false,
  href,
  className = "",
  style
}: Props) {
  const markSize = variant === "mark" ? 36 : variant === "compact" ? 32 : 44;

  const inner = (
    <span
      className={`inline-flex flex-col items-center ${variant === "compact" || variant === "mark" ? "items-start" : "items-center"} ${className}`}
      style={style}
      data-testid="stocvest-logo"
    >
      <span
        className={`inline-flex items-center ${variant === "full" ? "flex-col gap-3" : "gap-2.5"}`}
      >
        <LogoMark size={markSize} />
        {variant !== "mark" ? <LogoWordmark compact={variant === "compact"} /> : null}
      </span>
      {showTagline && variant === "full" ? <LogoTagline /> : null}
    </span>
  );

  if (href) {
    return (
      <Link href={href} className="no-underline hover:opacity-90" aria-label="STOCVEST home">
        {inner}
      </Link>
    );
  }

  return inner;
}
