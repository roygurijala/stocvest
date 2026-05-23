"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
const DOC_COUNT = AGREEMENTS_DOCUMENT_LINKS.length;

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
  const [wizardStep, setWizardStep] = useState<number | null>(null);
  const autoOpenedRef = useRef(false);

  const [readComplete, setReadComplete] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(AGREEMENTS_DOCUMENT_LINKS.map((d) => [d.href, false]))
  );
  const [agreed, setAgreed] = useState(false);

  const completedCount = AGREEMENTS_DOCUMENT_LINKS.filter((d) => readComplete[d.href]).length;
  const allRead = completedCount === DOC_COUNT;
  const firstUnreadIndex = AGREEMENTS_DOCUMENT_LINKS.findIndex((d) => !readComplete[d.href]);

  useEffect(() => {
    if (allRead) {
      setAgreed(true);
    } else {
      setAgreed(false);
    }
  }, [allRead]);

  const markRead = useCallback((href: string) => {
    setReadComplete((prev) => (prev[href] ? prev : { ...prev, [href]: true }));
  }, []);

  const openWizardAt = useCallback((index: number) => {
    const clamped = Math.max(0, Math.min(DOC_COUNT - 1, index));
    setWizardStep(clamped);
  }, []);

  const closeWizard = useCallback(() => {
    setWizardStep(null);
  }, []);

  useEffect(() => {
    if (autoOpenedRef.current || allRead) return;
    autoOpenedRef.current = true;
    openWizardAt(firstUnreadIndex >= 0 ? firstUnreadIndex : 0);
  }, [allRead, firstUnreadIndex, openWizardAt]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== LEGAL_DOCUMENT_READ_MESSAGE) return;
      const href = event.data.href;
      if (typeof href !== "string") return;

      markRead(href);
      const agreedIndex = AGREEMENTS_DOCUMENT_LINKS.findIndex((d) => d.href === href);
      const nextIndex = agreedIndex + 1;
      if (nextIndex < DOC_COUNT) {
        openWizardAt(nextIndex);
      } else {
        closeWizard();
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [markRead, openWizardAt, closeWizard]);

  const drawerOpen = wizardStep !== null;
  const activeDoc = wizardStep !== null ? AGREEMENTS_DOCUMENT_LINKS[wizardStep] : null;
  const reviewStep = wizardStep !== null ? wizardStep + 1 : Math.min(completedCount + 1, DOC_COUNT);
  const reviewLabel = allRead ? "Review agreements again" : `Review agreements (${reviewStep} of ${DOC_COUNT})`;

  const continueDisabled = !agreed;

  return (
    <>
      <LegalDocumentDrawer
        open={drawerOpen}
        href={activeDoc?.href ?? null}
        title={activeDoc?.label ?? ""}
        progressLabel={drawerOpen ? `${reviewStep} of ${DOC_COUNT}` : undefined}
        onClose={closeWizard}
      />

      <form action={action} className="grid gap-4">
        <p className="m-0 text-sm font-medium text-slate-200">
          You are registering under{" "}
          <span className="rounded bg-white/10 px-2 py-0.5 font-mono text-cyan-200">{agreementsBundleLabel()}</span>
        </p>
        <p className="m-0 text-sm text-slate-400">
          Walk through each document in order, scroll if needed, and click <span className="font-medium text-slate-300">I Agree</span>{" "}
          on each page. When all three are done, confirm below to continue.
        </p>

        <button
          type="button"
          onClick={() => openWizardAt(firstUnreadIndex >= 0 ? firstUnreadIndex : 0)}
          className="min-h-11 w-full rounded-md border border-[#3b82f6]/50 bg-[#3b82f6]/15 px-4 py-2.5 text-sm font-semibold text-[#93c5fd] transition hover:border-[#3b82f6] hover:bg-[#3b82f6]/25 hover:text-white"
        >
          {reviewLabel}
        </button>

        <p className="m-0 text-xs text-slate-500" role="status" aria-live="polite">
          {allRead
            ? "All three documents agreed — confirm the checkbox below to continue."
            : `${completedCount} of ${DOC_COUNT} documents agreed`}
        </p>

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

        {allRead ? (
          <ul className="m-0 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
            {AGREEMENTS_DOCUMENT_LINKS.map((doc, i) => (
              <li key={doc.href}>
                <button
                  type="button"
                  onClick={() => openWizardAt(i)}
                  className="text-[#38bdf8] underline decoration-[#38bdf8]/40 underline-offset-2 transition hover:text-cyan-200"
                >
                  Re-read {doc.label}
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <p className="m-0 text-xs leading-relaxed text-slate-500">
          Account creation is blocked until you complete this step. Your agreement is stored on your profile after you sign in.
        </p>
        {state.error ? <p className="m-0 text-sm text-rose-300">{state.error}</p> : null}
        <ContinueButton disabled={continueDisabled} />
      </form>
    </>
  );
}
