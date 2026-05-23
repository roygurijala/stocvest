"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useBodyScrollLock } from "@/lib/hooks/use-body-scroll-lock";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { withSignupLegalEmbed } from "@/lib/legal-agreements";

export function LegalDocumentDrawer({
  open,
  href,
  title,
  onClose,
}: {
  open: boolean;
  href: string | null;
  title: string;
  onClose: () => void;
}) {
  const titleId = useId();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [mounted, setMounted] = useState(false);
  const [slideIn, setSlideIn] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (open && href) {
      setSlideIn(false);
      const id = requestAnimationFrame(() => {
        requestAnimationFrame(() => setSlideIn(true));
      });
      return () => cancelAnimationFrame(id);
    }
    setSlideIn(false);
  }, [open, href]);

  useBodyScrollLock(open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!mounted || !open || !href) return null;

  return createPortal(
    <div className="fixed inset-0 z-[200]">
      <button
        type="button"
        className="absolute inset-0 z-0 bg-black/70 backdrop-blur-[1px] transition-opacity"
        aria-label="Close document panel"
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`absolute inset-y-0 left-0 z-10 flex h-full w-full max-w-2xl flex-col border-r border-white/10 bg-[#0a0e1a] shadow-[16px_0_48px_rgba(0,0,0,0.5)] transition-transform duration-300 ease-out ${
          slideIn ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-5">
          <h2 id={titleId} className="m-0 min-w-0 truncate text-base font-semibold text-slate-100 sm:text-lg">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex shrink-0 items-center justify-center rounded-md border border-white/15 p-2 text-slate-300 transition hover:border-white/30 hover:bg-white/5 hover:text-white"
            aria-label="Close"
          >
            <X className="h-5 w-5" strokeWidth={2} />
          </button>
        </header>
        <p className="shrink-0 border-b border-white/5 bg-[#0f172a] px-4 py-2 text-xs leading-relaxed text-slate-400 sm:px-5">
          Scroll to the bottom of this document, then click <span className="font-medium text-slate-300">I Agree</span>. If you close this
          panel before agreeing, this document will not count as read for signup.
        </p>
        <div className="relative min-h-0 flex-1 bg-[#070d18]">
          <iframe ref={iframeRef} title={title} src={withSignupLegalEmbed(href)} className="h-full w-full border-0" />
        </div>
      </aside>
    </div>,
    document.body
  );
}
