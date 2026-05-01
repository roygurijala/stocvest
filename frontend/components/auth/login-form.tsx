"use client";

import Link from "next/link";
import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { loginAsDevUser, loginWithPassword, type LoginActionState } from "@/app/login/actions";

const INITIAL_STATE: LoginActionState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="min-h-11 w-full rounded-md bg-[#3b82f6] px-4 py-2.5 font-semibold text-white shadow-[0_0_20px_rgba(59,130,246,0.35)] transition hover:shadow-[0_0_30px_rgba(59,130,246,0.6)] disabled:opacity-70"
    >
      {pending ? "Signing in..." : "Sign in"}
    </button>
  );
}

function DevSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="text-xs text-slate-400 transition hover:text-slate-200 disabled:opacity-60">
      {pending ? "Signing in..." : "Continue as dev user"}
    </button>
  );
}

export function LoginForm({ showDevBypass = false }: { showDevBypass?: boolean }) {
  const [showPassword, setShowPassword] = useState(false);
  const [state, formAction] = useFormState(loginWithPassword, INITIAL_STATE);
  const [devState, devFormAction] = useFormState(loginAsDevUser, INITIAL_STATE);
  return (
    <div className="grid w-full max-w-md gap-4">
      <form action={formAction} className="grid gap-4">
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
              placeholder="Enter password"
              className="w-full bg-transparent py-1 text-slate-100 placeholder:text-slate-500 focus:outline-none"
            />
            <button type="button" onClick={() => setShowPassword((v) => !v)} className="text-xs text-slate-400 hover:text-slate-200">
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>
        </div>
        {state.error ? <p className="m-0 text-sm text-rose-300">{state.error}</p> : null}
        <SubmitButton />
        <Link href="/forgot-password" className="justify-self-start text-sm text-slate-400 transition hover:text-slate-200">
          Forgot password?
        </Link>
      </form>
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-white/15" />
        <span className="text-xs uppercase tracking-wide text-slate-500">or</span>
        <div className="h-px flex-1 bg-white/15" />
      </div>
      <p className="text-sm text-slate-400">
        New to STOCVEST?{" "}
        <Link href="/signup" className="text-[#3b82f6] hover:underline">
          Get started
        </Link>
      </p>
      <p className="text-xs text-slate-500">Signals are not investment advice</p>
      {showDevBypass ? (
        <form action={devFormAction} className="grid gap-1">
          {devState.error ? <p className="m-0 text-xs text-rose-300">{devState.error}</p> : null}
          <DevSubmitButton />
        </form>
      ) : null}
    </div>
  );
}
