import type { ReactNode } from "react";
import { buildPageMetadata } from "@/lib/seo/metadata";

export const metadata = buildPageMetadata({
  path: "/new-password",
  title: "Set new password",
  noIndex: true
});

export default function NewPasswordLayout({ children }: { children: ReactNode }) {
  return children;
}
