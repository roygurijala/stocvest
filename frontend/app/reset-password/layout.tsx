import type { ReactNode } from "react";
import { buildPageMetadata } from "@/lib/seo/metadata";

export const metadata = buildPageMetadata({
  path: "/reset-password",
  title: "Reset password",
  noIndex: true
});

export default function ResetPasswordLayout({ children }: { children: ReactNode }) {
  return children;
}
