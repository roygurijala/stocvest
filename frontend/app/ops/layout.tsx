import type { ReactNode } from "react";
import { buildPageMetadata } from "@/lib/seo/metadata";

export const metadata = buildPageMetadata({
  path: "/ops",
  title: "Operations",
  noIndex: true
});

export default function OpsLayout({ children }: { children: ReactNode }) {
  return children;
}
