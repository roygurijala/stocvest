import { getServerSession } from "@/lib/auth/session";
import { isStocvestDevelopment } from "@/lib/auth/stocvest-env";
import {
  loginReasonMessage,
  loginReasonSecondary,
  sanitizeNextPath
} from "@/lib/auth/login-redirect";
import { LoginForm } from "@/components/auth/login-form";
import { AuthShell } from "@/components/auth/auth-shell";
import { LoginExpiredFlagClear } from "@/components/auth/login-expired-flag-clear";
import { redirect } from "next/navigation";

interface LoginPageSearchParams {
  message?: string;
  email?: string;
  reason?: string;
  next?: string;
}

export default function LoginPage({ searchParams }: { searchParams?: LoginPageSearchParams }) {
  const safeNext = sanitizeNextPath(searchParams?.next);
  const session = getServerSession();
  if (session) {
    // Send already-signed-in users to their intended destination, falling back to the dashboard.
    redirect(safeNext ?? "/dashboard");
  }

  const reasonPrimary = loginReasonMessage(searchParams?.reason);
  const reasonSecondary = loginReasonSecondary(searchParams?.reason);
  const successMessage = searchParams?.message;

  return (
    <AuthShell title="Welcome back." subtitle="Sign in with your email and password. Sessions are protected after authentication.">
      <LoginExpiredFlagClear />
      {reasonPrimary ? (
        <div
          role="status"
          aria-live="polite"
          className="mb-4 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200"
        >
          <p className="m-0">{reasonPrimary}</p>
          {reasonSecondary ? <p className="m-0 mt-1 text-xs text-amber-200/80">{reasonSecondary}</p> : null}
        </div>
      ) : null}
      {successMessage ? (
        <p className="mb-4 rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">{successMessage}</p>
      ) : null}
      <LoginForm
        showDevBypass={isStocvestDevelopment()}
        defaultEmail={searchParams?.email}
        nextPath={safeNext}
      />
    </AuthShell>
  );
}
