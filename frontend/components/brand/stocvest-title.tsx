"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  href?: string;
  className?: string;
  style?: CSSProperties;
  /** Larger wordmark for auth / marketing surfaces */
  size?: "nav" | "display";
};

/** Text wordmark — replaces image logo until brand artwork is finalized. */
export function StocvestTitle({ href, className = "", style, size = "nav" }: Props) {
  const { colors } = useTheme();
  const fontSize = size === "display" ? typography.scale["2xl"] : typography.scale.lg;

  const inner = (
    <span
      className={`inline-block font-bold tracking-tight ${className}`}
      style={{
        margin: 0,
        fontSize,
        lineHeight: 1.1,
        color: colors.text,
        letterSpacing: "0.02em",
        ...style
      }}
      data-testid="stocvest-title"
    >
      Stocvest
    </span>
  );

  if (href) {
    return (
      <Link href={href} className="no-underline hover:opacity-90" aria-label="Stocvest home">
        {inner}
      </Link>
    );
  }

  return inner;
}
