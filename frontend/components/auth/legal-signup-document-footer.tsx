"use client";

import { useCallback, useEffect, useState } from "react";
import { LEGAL_DOCUMENT_READ_MESSAGE } from "@/lib/legal-agreements";

function isScrolledToBottom(tolerancePx = 48): boolean {
  const de = document.documentElement;
  const body = document.body;
  const scrollHeight = Math.max(de.scrollHeight, body?.scrollHeight ?? 0);
  const clientHeight = window.innerHeight || de.clientHeight;
  if (scrollHeight <= clientHeight + tolerancePx) {
    return true;
  }
  const scrollTop = window.scrollY ?? de.scrollTop ?? body?.scrollTop ?? 0;
  return scrollTop + clientHeight >= scrollHeight - tolerancePx;
}

export function LegalSignupDocumentFooter({ href, label }: { href: string; label: string }) {
  const [scrolledToEnd, setScrolledToEnd] = useState(false);
  const [agreed, setAgreed] = useState(false);

  const checkScroll = useCallback(() => {
    setScrolledToEnd((prev) => prev || isScrolledToBottom());
  }, []);

  useEffect(() => {
    checkScroll();
    window.addEventListener("scroll", checkScroll, { passive: true });
    window.addEventListener("resize", checkScroll);
    const mo = new MutationObserver(checkScroll);
    mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    const t = window.setTimeout(checkScroll, 400);
    return () => {
      window.removeEventListener("scroll", checkScroll);
      window.removeEventListener("resize", checkScroll);
      mo.disconnect();
      window.clearTimeout(t);
    };
  }, [checkScroll]);

  const onAgree = () => {
    if (!scrolledToEnd || agreed) return;
    setAgreed(true);
    if (window.parent !== window) {
      window.parent.postMessage({ type: LEGAL_DOCUMENT_READ_MESSAGE, href }, window.location.origin);
    }
  };

  return (
    <div className="sticky bottom-0 z-10 border-t border-white/10 bg-[#0a0e1a]/95 px-4 py-4 backdrop-blur-sm md:px-8" role="region" aria-label={`Agreement for ${label}`}>
      {agreed ? (
        <p className="m-0 text-center text-sm font-medium text-emerald-300">
          You agreed to the {label}. Close this panel to continue registration.
        </p>
      ) : (
        <div className="mx-auto grid max-w-4xl gap-3">
          <p className="m-0 text-center text-xs leading-relaxed text-slate-400 sm:text-sm">
            {scrolledToEnd
              ? `By clicking I Agree, you confirm you have read the ${label} and accept it as part of creating your STOCVEST account.`
              : "Scroll to the bottom of this document to enable the I Agree button."}
          </p>
          <button
            type="button"
            disabled={!scrolledToEnd}
            onClick={onAgree}
            className="min-h-11 w-full rounded-md bg-[#3b82f6] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_0_16px_rgba(59,130,246,0.35)] transition hover:shadow-[0_0_24px_rgba(59,130,246,0.5)] disabled:cursor-not-allowed disabled:opacity-40 sm:text-base"
          >
            I Agree to the {label}
          </button>
        </div>
      )}
    </div>
  );
}
