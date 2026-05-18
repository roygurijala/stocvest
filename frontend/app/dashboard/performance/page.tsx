import { redirect } from "next/navigation";

export default function PerformanceRedirectPage() {
  redirect("/dashboard/setup-outcomes");
}
