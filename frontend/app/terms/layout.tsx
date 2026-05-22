import type { ReactNode } from "react";
import { buildPageMetadata } from "@/lib/seo/metadata";

export const metadata = buildPageMetadata({
  path: "/terms",
  title: "Terms of Service",
  description: "STOCVEST Terms of Service — platform rules, subscriptions, and user responsibilities."
});

export default function TermsLayout({ children }: { children: ReactNode }) {
  return children;
}
