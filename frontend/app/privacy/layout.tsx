import type { ReactNode } from "react";
import { buildPageMetadata } from "@/lib/seo/metadata";

export const metadata = buildPageMetadata({
  path: "/privacy",
  title: "Privacy Policy",
  description: "STOCVEST Privacy Policy — how we collect, use, and protect your account and platform activity data."
});

export default function PrivacyLayout({ children }: { children: ReactNode }) {
  return children;
}
