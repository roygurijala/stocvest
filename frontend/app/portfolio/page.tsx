import { redirect } from "next/navigation";

/** Legacy URL for the removed model signal book; broker portfolio lives at `/dashboard/portfolio`. */
export default function LegacyPortfolioRedirectPage() {
  redirect("/dashboard/setup-outcomes");
}
