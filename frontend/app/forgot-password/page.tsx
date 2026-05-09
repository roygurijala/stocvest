import Link from "next/link";
import { redirect } from "next/navigation";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { AuthShell } from "@/components/auth/auth-shell";
import { getServerSession } from "@/lib/auth/session";

export default function ForgotPasswordPage({ searchParams }: { searchParams?: { email?: string } }) {
  const session = getServerSession();
  if (session) {
    redirect("/dashboard");
  }

  return (
    <AuthShell title="Reset your password." subtitle="Enter the email on your account. We will send a secure reset code.">
      <ForgotPasswordForm defaultEmail={searchParams?.email} />
      <p className="mt-4 text-sm text-slate-400">
        Back to{" "}
        <Link href="/login" className="text-[#3b82f6] hover:underline">
          sign in
        </Link>
      </p>
    </AuthShell>
  );
}
