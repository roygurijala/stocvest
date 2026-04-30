"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { signupAction, type SignupActionState } from "@/app/signup/actions";

const INITIAL_STATE: SignupActionState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-2 w-full rounded-md bg-[#3b82f6] px-4 py-2.5 font-semibold text-white shadow-[0_0_20px_rgba(59,130,246,0.35)] transition hover:shadow-[0_0_30px_rgba(59,130,246,0.6)] disabled:opacity-70"
    >
      {pending ? "Creating account..." : "Create Account"}
    </button>
  );
}

export function SignupForm() {
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [state, action] = useFormState(signupAction, INITIAL_STATE);

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
      <div className="grid gap-1.5">
        <label htmlFor="password" className="text-sm text-slate-300">
          Password
        </label>
        <div className="flex items-center gap-2 rounded-md border border-white/15 bg-[#111827] px-3 py-1.5 focus-within:border-[#3b82f6]">
          <input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            required
            className="w-full bg-transparent py-1 text-slate-100 placeholder:text-slate-500 focus:outline-none"
          />
          <button type="button" onClick={() => setShowPassword((v) => !v)} className="text-xs text-slate-400 hover:text-slate-200">
            {showPassword ? "Hide" : "Show"}
          </button>
        </div>
        <ul className="mt-1 list-disc pl-5 text-xs text-slate-500">
          <li>At least 12 characters</li>
          <li>One uppercase letter</li>
          <li>One lowercase letter</li>
          <li>One number</li>
          <li>One special character</li>
        </ul>
      </div>
      <div className="grid gap-1.5">
        <label htmlFor="confirm_password" className="text-sm text-slate-300">
          Confirm password
        </label>
        <div className="flex items-center gap-2 rounded-md border border-white/15 bg-[#111827] px-3 py-1.5 focus-within:border-[#3b82f6]">
          <input
            id="confirm_password"
            name="confirm_password"
            type={showConfirmPassword ? "text" : "password"}
            required
            className="w-full bg-transparent py-1 text-slate-100 placeholder:text-slate-500 focus:outline-none"
          />
          <button type="button" onClick={() => setShowConfirmPassword((v) => !v)} className="text-xs text-slate-400 hover:text-slate-200">
            {showConfirmPassword ? "Hide" : "Show"}
          </button>
        </div>
      </div>
      {state.error ? <p className="m-0 text-sm text-rose-300">{state.error}</p> : null}
      <SubmitButton />
    </form>
  );
}
