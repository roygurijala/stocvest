import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/session";
import { VerifyEmailForm } from "@/components/auth/verify-email-form";
import { AuthShell } from "@/components/auth/auth-shell";

export default function VerifyEmailPage({ searchParams }: { searchParams?: { email?: string } }) {
  const session = getServerSession();
  if (session) {
    redirect("/dashboard");
  }
  const email = searchParams?.email || "";

  return (
    <AuthShell
      title="Check your email."
      subtitle={`We sent a verification code to ${email || "your inbox"}. Enter the code below to activate your account.`}
    >
      <VerifyEmailForm email={email} />
    </AuthShell>
  );
}
