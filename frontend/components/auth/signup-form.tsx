"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { signupAction, type SignupActionState } from "@/app/signup/actions";

const INITIAL_STATE: SignupActionState = {};

interface PasswordChecks {
  length: boolean;
  uppercase: boolean;
  lowercase: boolean;
  number: boolean;
  special: boolean;
}

function getPasswordChecks(password: string): PasswordChecks {
  return {
    length: password.length >= 12,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    number: /[0-9]/.test(password),
    special: /[!@#$%^&*]/.test(password)
  };
}

function allChecksMet(checks: PasswordChecks): boolean {
  return checks.length && checks.uppercase && checks.lowercase && checks.number && checks.special;
}

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className="mt-2 min-h-11 w-full rounded-md bg-[#3b82f6] px-4 py-2.5 font-semibold text-white shadow-[0_0_20px_rgba(59,130,246,0.35)] transition hover:shadow-[0_0_30px_rgba(59,130,246,0.6)] disabled:opacity-70"
    >
      {pending ? "Creating account..." : "Create Account"}
    </button>
  );
}

export function SignupForm() {
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [state, action] = useFormState(signupAction, INITIAL_STATE);
  const checks = getPasswordChecks(password);
  const requirementsMet = allChecksMet(checks);
  const confirmStarted = confirmPassword.length > 0;
  const passwordsMatch = password === confirmPassword;

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
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-transparent py-1 text-slate-100 placeholder:text-slate-500 focus:outline-none"
          />
          <button type="button" onClick={() => setShowPassword((v) => !v)} className="text-xs text-slate-400 hover:text-slate-200">
            {showPassword ? "Hide" : "Show"}
          </button>
        </div>
        <ul className="mt-1 grid gap-1 text-xs text-slate-500">
          {[
            ["At least 12 characters", checks.length],
            ["One uppercase letter (A-Z)", checks.uppercase],
            ["One lowercase letter (a-z)", checks.lowercase],
            ["One number (0-9)", checks.number],
            ["One special character (!@#$%^&*)", checks.special]
          ].map(([label, met]) => (
            <li
              key={String(label)}
              className={`transition-colors ${met ? "text-emerald-400 line-through" : "text-slate-500"}`}
            >
              <span className={`mr-2 ${met ? "text-emerald-400" : "text-slate-500"}`}>{met ? "✓" : "○"}</span>
              {label}
            </li>
          ))}
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
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="w-full bg-transparent py-1 text-slate-100 placeholder:text-slate-500 focus:outline-none"
          />
          <button type="button" onClick={() => setShowConfirmPassword((v) => !v)} className="text-xs text-slate-400 hover:text-slate-200">
            {showConfirmPassword ? "Hide" : "Show"}
          </button>
        </div>
        {confirmStarted ? (
          <p className={`m-0 text-xs ${passwordsMatch ? "text-emerald-400" : "text-rose-400"}`}>
            {passwordsMatch ? "Passwords match" : "Passwords do not match"}
          </p>
        ) : null}
      </div>
      {state.error ? <p className="m-0 text-sm text-rose-300">{state.error}</p> : null}
      <SubmitButton disabled={!requirementsMet || !passwordsMatch} />
    </form>
  );
}
