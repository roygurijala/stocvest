import { getServerSession } from "@/lib/auth/session";
import { isStocvestDevelopment } from "@/lib/auth/stocvest-env";
import { LoginForm } from "@/components/auth/login-form";
import { AuthShell } from "@/components/auth/auth-shell";
import { redirect } from "next/navigation";

export default function LoginPage({ searchParams }: { searchParams?: { message?: string } }) {
  const session = getServerSession();
  if (session) {
    redirect("/dashboard");
  }

  return (
    <AuthShell title="Welcome back." subtitle="Sign in with your email and password. Sessions are protected after authentication.">
      {searchParams?.message ? (
        <p className="mb-4 rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">{searchParams.message}</p>
      ) : null}
      <LoginForm showDevBypass={isStocvestDevelopment()} />
    </AuthShell>
  );
}
