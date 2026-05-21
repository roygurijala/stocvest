"use client";

import Image from "next/image";
import Link from "next/link";
import type { CSSProperties } from "react";

const BRAND_BASE = "/brand";

/**
 * Sized lockups from `public/brand/` (see README.txt).
 * Assets include a dark plate — no theme invert; they are meant for dark UI surfaces.
 */
export const STOCVEST_LOGO_VARIANTS = {
  /** Sidebar + mobile drawer */
  nav: {
    src: `${BRAND_BASE}/header_logo_600w.webp`,
    width: 600,
    height: 153,
    displayHeight: 44,
    maxWidth: 220
  },
  /** App top bar on dashboard routes */
  dashboard: {
    src: `${BRAND_BASE}/header_logo_900w.webp`,
    width: 900,
    height: 230,
    displayHeight: 52,
    maxWidth: 320
  },
  /** Landing fixed nav (compact; hero carries the large lockup) */
  header: {
    src: `${BRAND_BASE}/header_logo_400w.webp`,
    width: 400,
    height: 102,
    displayHeight: 36,
    maxWidth: 200
  },
  /** Landing hero — full wordmark + tagline */
  hero: {
    src: `${BRAND_BASE}/full_logo_with_tagline_1200w.webp`,
    width: 1200,
    height: 580,
    displayHeight: 240,
    maxWidth: 720
  },
  /** Login / signup card */
  stacked: {
    src: `${BRAND_BASE}/full_logo_with_tagline_600w.webp`,
    width: 600,
    height: 290,
    displayHeight: 112,
    maxWidth: 220
  },
  /** Landing / site footer */
  footer: {
    src: `${BRAND_BASE}/wordmark_only_300w.webp`,
    width: 300,
    height: 43,
    displayHeight: 28,
    maxWidth: 180
  }
} as const;

export type StocvestLogoVariant = keyof typeof STOCVEST_LOGO_VARIANTS;

type Props = {
  variant?: StocvestLogoVariant;
  href?: string;
  className?: string;
  style?: CSSProperties;
  priority?: boolean;
};

export function StocvestLogo({
  variant = "nav",
  href,
  className = "",
  style,
  priority = false
}: Props) {
  const asset = STOCVEST_LOGO_VARIANTS[variant];
  const displayWidth = Math.round((asset.displayHeight * asset.width) / asset.height);

  const imageStyle: CSSProperties = {
    width: displayWidth,
    height: asset.displayHeight,
    maxWidth: asset.maxWidth,
    objectFit: "contain",
    objectPosition: "center",
    ...style
  };

  const inner = (
    <span
      className={`inline-flex items-center justify-center ${className}`}
      data-testid="stocvest-logo"
      data-variant={variant}
    >
      <Image
        src={asset.src}
        alt="STOCVEST"
        width={asset.width}
        height={asset.height}
        className="h-auto w-auto max-w-full"
        style={imageStyle}
        priority={priority || variant === "nav" || variant === "hero"}
      />
    </span>
  );

  if (href) {
    return (
      <Link href={href} className="inline-flex no-underline hover:opacity-90" aria-label="STOCVEST home">
        {inner}
      </Link>
    );
  }

  return inner;
}
