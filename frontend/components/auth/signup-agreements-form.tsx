"use client";

import Link from "next/link";
import { useFormState, useFormStatus } from "react-dom";
import { acceptSignupAgreementsAction, type SignupAgreementsActionState } from "@/app/signup/agreements/actions";
import { AGREEMENTS_BUNDLE_VERSION, AGREEMENTS_DOCUMENT_LINKS, agreementsBundleLabel } from "@/lib/legal-agreements";

const INITIAL: SignupAgreementsActionState = {};

function ContinueButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-4 min-h-11 w-full rounded-md bg-[#3b82f6] px-4 py-2.5 font-semibold text-white shadow-[0_0_20px_rgba(59,130,246,0.35)] transition hover:shadow-[0_0_30px_rgba(59,130,246,0.6)] disabled:opacity-70"
    >
      {pending ? "Saving…" : "Continue to create account"}
    </button>
  );
}

export function SignupAgreementsForm() {
  const [state, action] = useFormState(acceptSignupAgreementsAction, INITIAL);

  return (
    <form action={action} className="grid gap-4">
      <p className="m-0 text-sm font-medium text-slate-200">
        You are registering under{" "}
        <span className="rounded bg-white/10 px-2 py-0.5 font-mono text-cyan-200">{agreementsBundleLabel()}</span>
      </p>
      <p className="m-0 text-sm text-slate-400">
        Review the documents below, then confirm with the checkbox. Account creation is only available after you agree.
      </p>
      <ul className="m-0 grid gap-2 text-sm text-slate-300">
        {AGREEMENTS_DOCUMENT_LINKS.map((doc) => (
          <li key={doc.href}>
            <Link href={doc.href} className="text-[#38bdf8] hover:underline" target="_blank" rel="noopener noreferrer">
              {doc.label}
            </Link>{" "}
            <span className="text-slate-500">(opens in a new tab)</span>
          </li>
        ))}
      </ul>
      <label className="flex cursor-pointer gap-3 rounded-lg border border-white/15 bg-[#0f172a] p-4 text-sm text-slate-200">
        <input id="accept_agreements" type="checkbox" name="accept_agreements" className="mt-1 h-4 w-4 shrink-0 accent-[#3b82f6]" />
        <span>
          I agree to the{" "}
          <Link href="/terms" target="_blank" rel="noopener noreferrer" className="text-[#38bdf8] hover:underline">
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link href="/privacy" target="_blank" rel="noopener noreferrer" className="text-[#38bdf8] hover:underline">
            Privacy Policy
          </Link>
          , including the risk disclosure (v{AGREEMENTS_BUNDLE_VERSION}).
        </span>
      </label>
      <p className="m-0 text-xs leading-relaxed text-slate-500">
        STOCVEST provides informational trading analysis only and does not provide investment advice, portfolio management,
        or trade recommendations.
      </p>
      {state.error ? <p className="m-0 text-sm text-rose-300">{state.error}</p> : null}
      <ContinueButton />
    </form>
  );
}
