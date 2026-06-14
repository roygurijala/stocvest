import { redirect } from "next/navigation";
import { PhoneVerifyForm } from "@/components/trial/phone-verify-form";
import { readSignupPhonePrefillFromCookies } from "@/lib/auth/persist-signup-profile";
import { getServerSession } from "@/lib/auth/session";

export default function OnboardingPhonePage() {
  const session = getServerSession();
  if (!session) {
    redirect("/login");
  }

  const initialPhone = readSignupPhonePrefillFromCookies();

  return (
    <main className="relative min-h-screen overflow-x-hidden bg-[#050810] px-4 py-10 sm:py-14">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 50% -20%, rgba(59,130,246,0.45), transparent 55%), radial-gradient(ellipse 60% 40% at 100% 100%, rgba(6,182,212,0.12), transparent 50%)"
        }}
        aria-hidden
      />
      <div className="relative z-10 mx-auto w-full max-w-lg">
        <section className="stocvest-edge-line-card border border-white/[0.08] bg-[#0c1222]/95 p-5 shadow-[0_24px_80px_-20px_rgba(0,0,0,0.75)] backdrop-blur-sm sm:p-7">
          <h1 className="m-0 text-2xl font-bold tracking-tight text-slate-50">Verify your phone</h1>
          <p className="mb-6 mt-2 text-sm leading-relaxed text-slate-400">
            Start your 14-day full-access trial after confirming your mobile number. One trial per phone number — this
            helps keep the platform fair.
          </p>
          <PhoneVerifyForm initialPhone={initialPhone ?? undefined} />
        </section>
      </div>
    </main>
  );
}
