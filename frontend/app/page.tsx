import { redirect } from "next/navigation";
import { LandingPage } from "@/components/landing-page";
import { getServerSession } from "@/lib/auth/session";

export default function HomePage() {
  const session = getServerSession();
  if (session) {
    redirect("/dashboard");
  }
  return <LandingPage />;
}
