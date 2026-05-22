import type { MetadataRoute } from "next";
import { INDEXED_PUBLIC_PATHS, SITE_URL } from "@/lib/seo/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = SITE_URL.replace(/\/$/, "");
  const lastModified = new Date();

  return INDEXED_PUBLIC_PATHS.map((path) => ({
    url: path === "/" ? `${base}/` : `${base}${path}`,
    lastModified,
    changeFrequency: path === "/" ? "daily" : "weekly",
    priority: path === "/" ? 1 : path === "/how-it-works" || path === "/performance" ? 0.9 : 0.7
  }));
}
