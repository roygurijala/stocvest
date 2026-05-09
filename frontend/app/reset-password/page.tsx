import { redirect } from "next/navigation";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { AuthShell } from "@/components/auth/auth-shell";
import { getServerSession } from "@/lib/auth/session";

export default function ResetPasswordPage({ searchParams }: { searchParams?: { email?: string } }) {
  const session = getServerSession();
  if (session) {
    redirect("/dashboard");
  }

  return (
    <AuthShell title="Choose a new password." subtitle="Enter the code from your email and set a new password for your account.">
      <ResetPasswordForm email={searchParams?.email || ""} />
    </AuthShell>
  );
}
