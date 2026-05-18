import { redirect } from "next/navigation";

export default function SignalValidationRedirectPage() {
  redirect("/dashboard/setup-outcomes");
}
