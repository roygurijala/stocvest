import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NewPasswordForm } from "@/components/auth/new-password-form";
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
    <main className="grid min-h-screen place-items-center bg-[#0a0e1a] px-4 py-10">
      <section className="w-full max-w-md rounded-xl border border-white/10 bg-[#111827] p-6 shadow-[0_0_30px_rgba(0,0,0,0.35)]">
        <h1 className="m-0 text-3xl font-bold text-slate-100">Set your password.</h1>
        <p className="mb-6 mt-1 text-slate-400">Enter a new password to continue.</p>
        <NewPasswordForm />
      </section>
    </main>
  );
}
