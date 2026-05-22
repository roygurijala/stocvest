import type { Metadata } from "next";
import {
  DEFAULT_DESCRIPTION,
  DEFAULT_OG_IMAGE_PATH,
  SITE_NAME,
  SITE_TAGLINE,
  SITE_URL
} from "./site";

export type PageMetadataOptions = {
  /** Path including leading slash, e.g. `/about`. */
  path: string;
  /** Page title without site suffix (home may use a full marketing title). */
  title: string;
  description?: string;
  /** When true, emits `noindex, nofollow` (auth, dashboard, ops). */
  noIndex?: boolean;
  /** Override Open Graph type (default `website`). */
  ogType?: "website" | "article";
  /** When set, replaces the default title template (useful for home). */
  titleAbsolute?: boolean;
};

export function canonicalUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const base = SITE_URL.replace(/\/$/, "");
  if (normalized === "/") return `${base}/`;
  return `${base}${normalized}`;
}

export function buildPageMetadata(options: PageMetadataOptions): Metadata {
  const description = options.description ?? DEFAULT_DESCRIPTION;
  const canonical = canonicalUrl(options.path);
  const title = options.titleAbsolute
    ? options.title
    : options.path === "/"
      ? options.title
      : `${options.title} | ${SITE_NAME}`;

  return {
    title,
    description,
    alternates: {
      canonical
    },
    openGraph: {
      type: options.ogType ?? "website",
      url: canonical,
      siteName: SITE_NAME,
      title,
      description,
      locale: "en_US",
      images: [
        {
          url: DEFAULT_OG_IMAGE_PATH,
          width: 1200,
          height: 630,
          alt: `${SITE_NAME} — ${SITE_TAGLINE}`
        }
      ]
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [DEFAULT_OG_IMAGE_PATH]
    },
    robots: options.noIndex
      ? { index: false, follow: false, googleBot: { index: false, follow: false } }
      : {
          index: true,
          follow: true,
          googleBot: { index: true, follow: true, "max-image-preview": "large" }
        }
  };
}

/** Root layout defaults — pair with `metadataBase` in `app/layout.tsx`. */
export function rootSiteMetadata(): Metadata {
  return {
    metadataBase: new URL(SITE_URL),
    applicationName: SITE_NAME,
    title: {
      default: `${SITE_NAME} — ${SITE_TAGLINE}`,
      template: `%s | ${SITE_NAME}`
    },
    description: DEFAULT_DESCRIPTION,
    alternates: {
      canonical: "/"
    },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      locale: "en_US",
      images: [
        {
          url: DEFAULT_OG_IMAGE_PATH,
          width: 1200,
          height: 630,
          alt: `${SITE_NAME} — ${SITE_TAGLINE}`
        }
      ]
    },
    twitter: {
      card: "summary_large_image"
    },
    robots: {
      index: true,
      follow: true,
      googleBot: { index: true, follow: true, "max-image-preview": "large" }
    },
    formatDetection: {
      telephone: false,
      email: false,
      address: false
    }
  };
}
