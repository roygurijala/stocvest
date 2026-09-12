import { redirect } from "next/navigation";

/**
 * Legacy `/portfolio` URL. The manual "STOCVEST manages my portfolio" workspace lives at
 * `/dashboard/my-portfolio`; the paused broker portfolio is at `/dashboard/portfolio`.
 * Point the bare URL at the manual portfolio so bookmarks/links land on the live feature.
 */
export default function LegacyPortfolioRedirectPage() {
  redirect("/dashboard/my-portfolio");
}
