/** Canonical production host — override with NEXT_PUBLIC_SITE_URL in Vercel if needed. */
export const SITE_URL =
  (typeof process.env.NEXT_PUBLIC_SITE_URL === "string"
    ? process.env.NEXT_PUBLIC_SITE_URL.trim()
    : "") || "https://stocvest.ai";

export const SITE_NAME = "STOCVEST";

export const SITE_TAGLINE = "Multi-layer swing and day trading signal intelligence";

export const DEFAULT_DESCRIPTION =
  "STOCVEST combines six independent signal layers — technical, news, macro, sector, geopolitical, and market internals — into transparent swing and day-trading context. Not black-box alerts.";

/** Open Graph / social preview (1200×630-friendly brand lockup). */
export const DEFAULT_OG_IMAGE_PATH = "/brand/full_logo_with_tagline_1200w.png";

export const SUPPORT_EMAIL = "support@stocvest.ai";

/** Public marketing routes that should appear in sitemap.xml and be indexed. */
export const INDEXED_PUBLIC_PATHS = [
  "/",
  "/about",
  "/how-it-works",
  "/performance",
  "/terms",
  "/privacy",
  "/security",
  "/legal/risk-disclosure"
] as const;

export type IndexedPublicPath = (typeof INDEXED_PUBLIC_PATHS)[number];
