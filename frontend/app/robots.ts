import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo/site";

export default function robots(): MetadataRoute.Robots {
  const base = SITE_URL.replace(/\/$/, "");

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/dashboard/",
          "/dashboard",
          "/ops/",
          "/ops",
          "/api/",
          "/login",
          "/signup",
          "/register",
          "/forgot-password",
          "/reset-password",
          "/new-password",
          "/verify-email"
        ]
      }
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base
  };
}
