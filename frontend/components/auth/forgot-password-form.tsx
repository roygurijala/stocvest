"use client";

import { useFormState, useFormStatus } from "react-dom";
import { forgotPasswordAction, type ForgotPasswordActionState } from "@/app/forgot-password/actions";

const INITIAL_STATE: ForgotPasswordActionState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-md bg-[#3b82f6] px-4 py-2.5 font-semibold text-white shadow-[0_0_20px_rgba(59,130,246,0.35)] transition hover:shadow-[0_0_30px_rgba(59,130,246,0.6)] disabled:opacity-70"
    >
      {pending ? "Sending..." : "Send Reset Code"}
    </button>
  );
}

export function ForgotPasswordForm() {
  const [state, action] = useFormState(forgotPasswordAction, INITIAL_STATE);

  return (
    <form action={action} className="grid gap-4">
      <div className="grid gap-1.5">
        <label htmlFor="email" className="text-sm text-slate-300">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          placeholder="you@example.com"
          className="rounded-md border border-white/15 bg-[#111827] px-3 py-2.5 text-slate-100 placeholder:text-slate-500 focus:border-[#3b82f6] focus:outline-none"
        />
      </div>
      {state.error ? <p className="m-0 text-sm text-rose-300">{state.error}</p> : null}
      <SubmitButton />
    </form>
  );
}
