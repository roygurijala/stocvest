"use client";

import { useCallback, useEffect, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { acceptSignupAgreementsAction, type SignupAgreementsActionState } from "@/app/signup/agreements/actions";
import {
  AGREEMENTS_BUNDLE_VERSION,
  AGREEMENTS_DOCUMENT_LINKS,
  LEGAL_DOCUMENT_READ_MESSAGE,
  agreementsBundleLabel,
  signupLegalReadFieldName,
} from "@/lib/legal-agreements";
import { LegalDocumentDrawer } from "@/components/auth/legal-document-drawer";

const INITIAL: SignupAgreementsActionState = {};

function ContinueButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className="mt-4 min-h-11 w-full rounded-md bg-[#3b82f6] px-4 py-2.5 font-semibold text-white shadow-[0_0_20px_rgba(59,130,246,0.35)] transition hover:shadow-[0_0_30px_rgba(59,130,246,0.6)] disabled:cursor-not-allowed disabled:opacity-40"
    >
      {pending ? "Saving…" : "I Agree — Continue to create account"}
    </button>
  );
}

export function SignupAgreementsForm() {
  const [state, action] = useFormState(acceptSignupAgreementsAction, INITIAL);
  const [drawer, setDrawer] = useState<{ href: string; label: string } | null>(null);

  const [readComplete, setReadComplete] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(AGREEMENTS_DOCUMENT_LINKS.map((d) => [d.href, false]))
  );
  const [agreed, setAgreed] = useState(false);

  const allRead = AGREEMENTS_DOCUMENT_LINKS.every((d) => readComplete[d.href]);

  useEffect(() => {
    if (!allRead) {
      setAgreed(false);
    }
  }, [allRead]);

  const markRead = useCallback((href: string) => {
    setReadComplete((prev) => (prev[href] ? prev : { ...prev, [href]: true }));
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== LEGAL_DOCUMENT_READ_MESSAGE) return;
      const href = event.data.href;
      if (typeof href === "string") {
        markRead(href);
        setDrawer((current) => (current?.href === href ? null : current));
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [markRead]);

  const openDoc = useCallback((href: string, label: string) => {
    setDrawer({ href, label });
  }, []);

  const continueDisabled = !agreed;

  return (
    <>
      <LegalDocumentDrawer open={!!drawer} href={drawer?.href ?? null} title={drawer?.label ?? ""} onClose={() => setDrawer(null)} />

      <form action={action} className="grid gap-4">
        <p className="m-0 text-sm font-medium text-slate-200">
          You are registering under{" "}
          <span className="rounded bg-white/10 px-2 py-0.5 font-mono text-cyan-200">{agreementsBundleLabel()}</span>
        </p>
        <p className="m-0 text-sm text-slate-400">
          Open each document below, scroll if needed, and click <span className="font-medium text-slate-300">I Agree</span> — the
          panel closes automatically. You can re-read these documents anytime after sign-in.
        </p>
        <ul className="m-0 grid gap-2 text-sm text-slate-300">
          {AGREEMENTS_DOCUMENT_LINKS.map((doc) => {
            const done = readComplete[doc.href];
            return (
              <li key={doc.href} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <button
                  type="button"
                  onClick={() => openDoc(doc.href, doc.label)}
                  className="text-left text-[#38bdf8] underline decoration-[#38bdf8]/50 underline-offset-2 transition hover:text-cyan-200"
                >
                  {doc.label}
                </button>
                <span className={done ? "text-emerald-400/90" : "text-slate-500"}>{done ? "· Agreed" : "· Not agreed yet"}</span>
              </li>
            );
          })}
        </ul>
        {AGREEMENTS_DOCUMENT_LINKS.map((doc) =>
          readComplete[doc.href] ? <input key={doc.key} type="hidden" name={signupLegalReadFieldName(doc.key)} value="1" /> : null
        )}
        <div
          className={`flex gap-3 rounded-lg border border-white/15 bg-[#0f172a] p-4 text-sm text-slate-200 ${
            allRead ? "" : "cursor-not-allowed opacity-60"
          }`}
        >
          <input
            id="accept_agreements"
            type="checkbox"
            name="accept_agreements"
            disabled={!allRead}
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-1 h-4 w-4 shrink-0 accent-[#3b82f6] disabled:cursor-not-allowed"
          />
          <label htmlFor="accept_agreements" className={`min-w-0 flex-1 leading-relaxed ${allRead ? "cursor-pointer" : "cursor-not-allowed"}`}>
            I have read and agreed to the Terms of Service, Privacy Policy, and risk disclosure (bundle version {AGREEMENTS_BUNDLE_VERSION})
            and understand that STOCVEST provides informational analysis only, not investment advice.
          </label>
        </div>
        <p className="m-0 text-xs leading-relaxed text-slate-500">
          Account creation is blocked until you complete this step. Your agreement is stored on your profile after you sign in.
        </p>
        {state.error ? <p className="m-0 text-sm text-rose-300">{state.error}</p> : null}
        <ContinueButton disabled={continueDisabled} />
      </form>
    </>
  );
}
