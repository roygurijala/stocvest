"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { useBodyScrollLock } from "@/lib/hooks/use-body-scroll-lock";

export type AppOverlayScrimVariant = "modal" | "assistant-mobile" | "assistant-desktop";

type Props = {
  open: boolean;
  variant?: AppOverlayScrimVariant;
  /** When set, clicking the scrim calls this (mobile assistant). */
  onClose?: () => void;
  zIndex?: number;
  testId?: string;
  lockScroll?: boolean;
};

function scrimClass(variant: AppOverlayScrimVariant): string {
  if (variant === "assistant-mobile") return "app-overlay-scrim app-overlay-scrim--assistant-mobile";
  if (variant === "assistant-desktop") return "app-overlay-scrim app-overlay-scrim--assistant-desktop";
  return "app-overlay-scrim app-overlay-scrim--modal";
}

/**
 * Full-viewport scrim portaled to `document.body`.
 * Used for assistant backdrops; modals usually fold blur into their root overlay.
 */
export function AppOverlayScrim({
  open,
  variant = "modal",
  onClose,
  zIndex = 85,
  testId,
  lockScroll
}: Props) {
  const [mounted, setMounted] = useState(false);
  const shouldLock = lockScroll ?? variant !== "assistant-desktop";

  useBodyScrollLock(open && shouldLock);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open || !onClose) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!mounted || !open) return null;

  const interactive = variant !== "assistant-desktop" && Boolean(onClose);

  return createPortal(
    <button
      type="button"
      className={scrimClass(variant)}
      style={{ zIndex }}
      aria-label={interactive ? "Close" : undefined}
      tabIndex={interactive ? 0 : -1}
      onClick={interactive ? onClose : undefined}
      data-testid={testId}
    />,
    document.body
  );
}
