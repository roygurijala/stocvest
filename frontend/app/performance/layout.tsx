import type { ReactNode } from "react";
import { buildPageMetadata } from "@/lib/seo/metadata";

export const metadata = buildPageMetadata({
  path: "/performance",
  title: "Signal performance",
  description:
    "Public directional accuracy and resolved signal outcomes for STOCVEST swing and day setups — transparent validation, not performance marketing."
});

export default function PerformanceLayout({ children }: { children: ReactNode }) {
  return children;
}
