"use client";

import Image from "next/image";
import Link from "next/link";
import type { CSSProperties } from "react";
import { useTheme } from "@/lib/theme-provider";

export type StocvestLogoVariant = "full" | "compact" | "mark";

const BRAND_ASSET = "/brand/stocvest-logo-full.png";

type Props = {
  variant?: StocvestLogoVariant;
  /** Full lockup includes tagline in the PNG when true (default asset). */
  showTagline?: boolean;
  href?: string;
  className?: string;
  style?: CSSProperties;
};

/**
 * Authoritative brand artwork from `public/brand/stocvest-logo-full.png`.
 * Theme filter only on light mode for contrast on pale surfaces.
 */
export function StocvestLogo({
  variant = "compact",
  showTagline = false,
  href,
  className = "",
  style
}: Props) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const toneFilter = isDark ? undefined : "brightness(0.88) contrast(1.08)";

  const height =
    variant === "full" ? (showTagline ? 148 : 120) : variant === "compact" ? 40 : 36;
  const width = variant === "full" ? 240 : variant === "compact" ? 128 : 36;

  const inner = (
    <span
      className={`inline-flex ${className}`}
      style={style}
      data-testid="stocvest-logo"
      data-variant={variant}
    >
      <Image
        src={BRAND_ASSET}
        alt="STOCVEST"
        width={width}
        height={height}
        className="h-auto max-w-full object-contain object-left"
        style={{
          width,
          height,
          filter: toneFilter
        }}
        priority={variant !== "mark"}
      />
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
