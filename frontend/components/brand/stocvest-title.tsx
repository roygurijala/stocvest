"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  href?: string;
  className?: string;
  style?: CSSProperties;
  size?: "page" | "display";
};

/** Text wordmark — accent blue on dashboard and auth surfaces. */
export function StocvestTitle({ href, className = "", style, size = "page" }: Props) {
  const { colors } = useTheme();
  const fontSize = size === "display" ? typography.scale["3xl"] : typography.scale["2xl"];

  const inner = (
    <span
      className={`inline-block font-bold tracking-tight ${className}`}
      data-testid="stocvest-title"
      style={{
        margin: 0,
        fontSize,
        lineHeight: 1.1,
        color: colors.accent,
        letterSpacing: "0.02em",
        ...style
      }}
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
