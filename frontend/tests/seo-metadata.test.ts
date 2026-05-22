import { describe, expect, test } from "vitest";
import { buildPageMetadata, canonicalUrl } from "@/lib/seo/metadata";
import { INDEXED_PUBLIC_PATHS, SITE_URL } from "@/lib/seo/site";

describe("canonicalUrl", () => {
  test("home resolves to trailing slash on canonical host", () => {
    expect(canonicalUrl("/")).toBe(`${SITE_URL.replace(/\/$/, "")}/`);
  });

  test("nested paths preserve path segment", () => {
    expect(canonicalUrl("/about")).toBe(`${SITE_URL.replace(/\/$/, "")}/about`);
  });
});

describe("buildPageMetadata", () => {
  test("indexed page includes canonical alternates", () => {
    const meta = buildPageMetadata({
      path: "/how-it-works",
      title: "How it works",
      description: "Test description"
    });
    expect(meta.alternates?.canonical).toBe(canonicalUrl("/how-it-works"));
    expect(meta.robots).toMatchObject({ index: true, follow: true });
  });

  test("noIndex pages block crawlers", () => {
    const meta = buildPageMetadata({
      path: "/login",
      title: "Sign in",
      noIndex: true
    });
    expect(meta.robots).toMatchObject({ index: false, follow: false });
    expect(meta.alternates?.canonical).toBe(canonicalUrl("/login"));
  });

  test("subpage title uses site suffix", () => {
    const meta = buildPageMetadata({ path: "/about", title: "About" });
    expect(meta.title).toBe("About | STOCVEST");
  });
});

describe("INDEXED_PUBLIC_PATHS", () => {
  test("includes core marketing routes for sitemap", () => {
    expect(INDEXED_PUBLIC_PATHS).toContain("/");
    expect(INDEXED_PUBLIC_PATHS).toContain("/how-it-works");
    expect(INDEXED_PUBLIC_PATHS).toContain("/performance");
    expect(INDEXED_PUBLIC_PATHS).not.toContain("/login");
    expect(INDEXED_PUBLIC_PATHS).not.toContain("/dashboard");
  });
});
