import type { ReactNode } from "react";
import { buildPageMetadata } from "@/lib/seo/metadata";

export const metadata = buildPageMetadata({
  path: "/forgot-password",
  title: "Forgot password",
  noIndex: true
});

export default function ForgotPasswordLayout({ children }: { children: ReactNode }) {
  return children;
}
