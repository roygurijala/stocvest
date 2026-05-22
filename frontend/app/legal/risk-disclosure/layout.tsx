import type { ReactNode } from "react";
import { buildPageMetadata } from "@/lib/seo/metadata";

export const metadata = buildPageMetadata({
  path: "/legal/risk-disclosure",
  title: "Risk disclosure",
  description:
    "STOCVEST risk disclosure — trading involves substantial risk; signals are informational context, not investment advice."
});

export default function RiskDisclosureLayout({ children }: { children: ReactNode }) {
  return children;
}
