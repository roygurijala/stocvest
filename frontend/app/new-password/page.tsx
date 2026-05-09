import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NewPasswordForm } from "@/components/auth/new-password-form";
import { AuthShell } from "@/components/auth/auth-shell";
import { getServerSession } from "@/lib/auth/session";

const NEW_PASSWORD_SESSION_COOKIE = "stocvest_new_password_session";

export default function NewPasswordPage() {
  const session = getServerSession();
  if (session) {
    redirect("/dashboard");
  }
  const challengeSession = cookies().get(NEW_PASSWORD_SESSION_COOKIE)?.value;
  if (!challengeSession) {
    redirect("/login");
  }

  return (
    <AuthShell title="Set your password." subtitle="Choose a strong password you have not used elsewhere.">
      <NewPasswordForm />
    </AuthShell>
  );
}
