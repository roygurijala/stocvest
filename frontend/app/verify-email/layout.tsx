import type { ReactNode } from "react";
import { buildPageMetadata } from "@/lib/seo/metadata";

export const metadata = buildPageMetadata({
  path: "/verify-email",
  title: "Verify email",
  noIndex: true
});

export default function VerifyEmailLayout({ children }: { children: ReactNode }) {
  return children;
}
