import { describe, expect, test } from "vitest";
import sitemap from "@/app/sitemap";
import robots from "@/app/robots";
import { SITE_URL } from "@/lib/seo/site";

describe("sitemap", () => {
  test("lists only canonical stocvest.ai URLs", () => {
    const entries = sitemap();
    const base = SITE_URL.replace(/\/$/, "");
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.url.startsWith(base)).toBe(true);
      expect(entry.url).not.toContain("stocvest.app");
    }
    expect(entries.some((e) => e.url === `${base}/`)).toBe(true);
    expect(entries.some((e) => e.url === `${base}/how-it-works`)).toBe(true);
  });
});

describe("robots", () => {
  test("points crawlers at sitemap on canonical host", () => {
    const rules = robots();
    const base = SITE_URL.replace(/\/$/, "");
    expect(rules.sitemap).toBe(`${base}/sitemap.xml`);
    expect(rules.host).toBe(base);
  });

  test("disallows dashboard and auth surfaces", () => {
    const rules = robots();
    const disallow = rules.rules[0]?.disallow ?? [];
    expect(disallow).toContain("/dashboard/");
    expect(disallow).toContain("/login");
  });
});
