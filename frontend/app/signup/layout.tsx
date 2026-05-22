import type { ReactNode } from "react";
import { buildPageMetadata } from "@/lib/seo/metadata";

export const metadata = buildPageMetadata({
  path: "/signup",
  title: "Create account",
  description: "Create your STOCVEST account.",
  noIndex: true
});

export default function SignupLayout({ children }: { children: ReactNode }) {
  return children;
}
