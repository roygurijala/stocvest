"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { clearSignupPhonePrefillCookie } from "@/lib/auth/signup-profile-actions";

type Step = "phone" | "code";

export function PhoneVerifyForm({ initialPhone }: { initialPhone?: string }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState(initialPhone ?? "");
  const [smsOptIn, setSmsOptIn] = useState(false);
  const [code, setCode] = useState("");
  const [phoneLast4, setPhoneLast4] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function requestCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await fetch("/api/stocvest/users/me/phone/request-code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone_e164: phone.trim(), sms_opt_in: smsOptIn })
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string; phone_last4?: string };
      if (!res.ok) {
        setError(data.message ?? "Could not send verification code.");
        return;
      }
      setPhoneLast4(data.phone_last4 ?? null);
      setStep("code");
    } catch {
      setError("Network error. Try again.");
    } finally {
      setPending(false);
    }
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await fetch("/api/stocvest/users/me/phone/verify-code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: code.trim() })
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) {
        setError(data.message ?? "Verification failed.");
        return;
      }
      await clearSignupPhonePrefillCookie();
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setPending(false);
    }
  }

  if (step === "code") {
    return (
      <form onSubmit={verifyCode} className="grid gap-4">
        <p className="text-sm text-slate-400">
          Enter the 6-digit code we sent{phoneLast4 ? ` to the number ending in ${phoneLast4}` : ""}.
        </p>
        <label className="grid gap-1.5 text-sm text-slate-300">
          Verification code
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(ev) => setCode(ev.target.value.replace(/\D/g, "").slice(0, 6))}
            className="rounded-md border border-white/10 bg-[#0a1020] px-3 py-2.5 text-slate-100"
            required
          />
        </label>
        {error ? <p className="text-sm text-rose-400">{error}</p> : null}
        <button
          type="submit"
          disabled={pending || code.length !== 6}
          className="min-h-11 rounded-md bg-[#3b82f6] px-4 py-2.5 font-semibold text-white disabled:opacity-60"
        >
          {pending ? "Verifying…" : "Verify & start trial"}
        </button>
        <button
          type="button"
          className="text-sm text-slate-400 underline-offset-2 hover:text-slate-200 hover:underline"
          onClick={() => {
            setStep("phone");
            setCode("");
            setError(null);
          }}
        >
          Use a different number
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={requestCode} className="grid gap-4">
      <label className="grid gap-1.5 text-sm text-slate-300">
        Mobile number (E.164)
        <input
          type="tel"
          autoComplete="tel"
          placeholder="+1 555 123 4567"
          value={phone}
          onChange={(ev) => setPhone(ev.target.value)}
          className="rounded-md border border-white/10 bg-[#0a1020] px-3 py-2.5 text-slate-100"
          required
        />
      </label>
      <label className="flex items-start gap-2 text-sm text-slate-400">
        <input
          type="checkbox"
          checked={smsOptIn}
          onChange={(ev) => setSmsOptIn(ev.target.checked)}
          className="mt-1"
          required
        />
        <span>
          I agree to receive a one-time SMS verification code and trial reminders at this number. Message and data rates
          may apply.
        </span>
      </label>
      {error ? <p className="text-sm text-rose-400">{error}</p> : null}
      <button
        type="submit"
        disabled={pending || !phone.trim() || !smsOptIn}
        className="min-h-11 rounded-md bg-[#3b82f6] px-4 py-2.5 font-semibold text-white disabled:opacity-60"
      >
        {pending ? "Sending code…" : "Send verification code"}
      </button>
    </form>
  );
}
