"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { acceptSignupAgreementsAction, type SignupAgreementsActionState } from "@/app/signup/agreements/actions";
import { AGREEMENTS_BUNDLE_VERSION, AGREEMENTS_DOCUMENT_LINKS, agreementsBundleLabel } from "@/lib/legal-agreements";
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
      {pending ? "Saving…" : "Continue to create account"}
    </button>
  );
}

export function SignupAgreementsForm() {
  const [state, action] = useFormState(acceptSignupAgreementsAction, INITIAL);
  const [drawer, setDrawer] = useState<{ href: string; label: string } | null>(null);
  const drawerRef = useRef(drawer);
  drawerRef.current = drawer;

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

  const openDoc = useCallback((href: string, label: string) => {
    setDrawer({ href, label });
  }, []);

  const onDrawerReachedBottom = useCallback(() => {
    const d = drawerRef.current;
    if (d) markRead(d.href);
  }, [markRead]);

  const continueDisabled = !agreed;

  return (
    <>
      <LegalDocumentDrawer
        open={!!drawer}
        href={drawer?.href ?? null}
        title={drawer?.label ?? ""}
        onClose={() => setDrawer(null)}
        onReachedBottom={onDrawerReachedBottom}
      />

      <form action={action} className="grid gap-4">
        <p className="m-0 text-sm font-medium text-slate-200">
          You are registering under{" "}
          <span className="rounded bg-white/10 px-2 py-0.5 font-mono text-cyan-200">{agreementsBundleLabel()}</span>
        </p>
        <p className="m-0 text-sm text-slate-400">
          Open each document in the side panel, scroll to the bottom, then close the panel. The agreement checkbox stays disabled until every
          document is marked read.
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
                <span className={done ? "text-emerald-400/90" : "text-slate-500"}>{done ? "· Read" : "· Not read yet"}</span>
              </li>
            );
          })}
        </ul>
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
            I have read each document above (scroll to the end in the panel) and I agree to the Terms of Service, Privacy Policy, and risk
            disclosure for bundle version {AGREEMENTS_BUNDLE_VERSION}.
          </label>
        </div>
        <p className="m-0 text-xs leading-relaxed text-slate-500">
          STOCVEST provides informational trading analysis only and does not provide investment advice, portfolio management, or trade
          recommendations.
        </p>
        {state.error ? <p className="m-0 text-sm text-rose-300">{state.error}</p> : null}
        <ContinueButton disabled={continueDisabled} />
      </form>
    </>
  );
}
