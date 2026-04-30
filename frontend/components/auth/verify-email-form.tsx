"use client";

import { useFormState, useFormStatus } from "react-dom";
import { resendVerificationAction, verifyEmailAction, type VerifyEmailActionState } from "@/app/verify-email/actions";

const INITIAL_STATE: VerifyEmailActionState = {};

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-md bg-[#3b82f6] px-4 py-2.5 font-semibold text-white shadow-[0_0_20px_rgba(59,130,246,0.35)] transition hover:shadow-[0_0_30px_rgba(59,130,246,0.6)] disabled:opacity-70"
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

export function VerifyEmailForm({ email }: { email: string }) {
  const [state, verifyAction] = useFormState(verifyEmailAction, INITIAL_STATE);
  const [resendState, resendAction] = useFormState(resendVerificationAction, INITIAL_STATE);

  return (
    <div className="grid gap-4">
      <form action={verifyAction} className="grid gap-3">
        <input type="hidden" name="email" value={email} />
        <label htmlFor="code" className="text-sm text-slate-300">
          Verification code
        </label>
        <input
          id="code"
          name="code"
          inputMode="numeric"
          pattern="[0-9]{6}"
          placeholder="123456"
          required
          className="rounded-md border border-white/15 bg-[#111827] px-3 py-2.5 tracking-[0.35em] text-slate-100 placeholder:text-slate-500 focus:border-[#3b82f6] focus:outline-none"
        />
        {state.error ? <p className="m-0 text-sm text-rose-300">{state.error}</p> : null}
        <SubmitButton label="Verify" pendingLabel="Verifying..." />
      </form>
      <form action={resendAction}>
        <input type="hidden" name="email" value={email} />
        <button type="submit" className="text-sm text-slate-400 transition hover:text-slate-200">
          Resend code
        </button>
      </form>
      {resendState.error ? <p className="m-0 text-sm text-slate-400">{resendState.error}</p> : null}
    </div>
  );
}
