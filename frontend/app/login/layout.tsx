import type { ReactNode } from "react";
import { buildPageMetadata } from "@/lib/seo/metadata";

export const metadata = buildPageMetadata({
  path: "/login",
  title: "Sign in",
  description: "Sign in to your STOCVEST account.",
  noIndex: true
});

export default function LoginLayout({ children }: { children: ReactNode }) {
  return children;
}
