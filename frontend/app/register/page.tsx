import { redirect } from "next/navigation";

/** Marketing CTAs use `/register`; canonical signup flow starts at agreements. */
export default function RegisterRedirectPage() {
  redirect("/signup/agreements");
}
