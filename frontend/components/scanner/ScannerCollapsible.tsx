"use client";

import { useEffect, useRef, type ReactNode, type SyntheticEvent } from "react";
import { ChevronRight } from "lucide-react";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  testId: string;
  title: string;
  hint?: string;
  children: ReactNode;
  defaultOpen?: boolean;
  /** When set, open state persists in sessionStorage for this tab. */
  persistSessionKey?: string;
  /** Nested inside another collapsible — lighter chrome. */
  embedded?: boolean;
  /** When true, programmatically opens the section (e.g. search jump). */
  forceOpen?: boolean;
};

export function ScannerCollapsible({
  testId,
  title,
  hint,
  children,
  defaultOpen = false,
  persistSessionKey,
  embedded = false,
  forceOpen = false
}: Props) {
  const { colors } = useTheme();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const initialized = useRef(false);

  const persistOpenState = (open: boolean) => {
    if (!persistSessionKey || typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem(persistSessionKey, open ? "1" : "0");
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    const el = detailsRef.current;
    if (!el || initialized.current) return;
    initialized.current = true;
    if (!persistSessionKey) {
      el.open = defaultOpen;
      return;
    }
    if (typeof window === "undefined") return;
    try {
      const v = window.sessionStorage.getItem(persistSessionKey);
      if (v === "1") el.open = true;
      else if (v === "0") el.open = false;
      else el.open = defaultOpen;
    } catch {
      el.open = defaultOpen;
    }
  }, [defaultOpen, persistSessionKey]);

  useEffect(() => {
    const el = detailsRef.current;
    if (!el || !persistSessionKey) return;
    const onToggle = () => persistOpenState(el.open);
    el.addEventListener("toggle", onToggle);
    return () => el.removeEventListener("toggle", onToggle);
  }, [persistSessionKey]);

  useEffect(() => {
    const el = detailsRef.current;
    if (!el || !forceOpen) return;
    el.open = true;
    if (persistSessionKey) persistOpenState(true);
  }, [forceOpen, persistSessionKey]);

  const handleToggle = (e: SyntheticEvent<HTMLDetailsElement>) => {
    persistOpenState(e.currentTarget.open);
  };

  return (
    <details
      ref={detailsRef}
      data-testid={testId}
      className={`scanner-collapsible${embedded ? " scanner-collapsible--embedded" : ""}`}
      onToggle={handleToggle}
      style={
        embedded
          ? undefined
          : {
              borderRadius: borderRadius.lg,
              border: `1px solid ${colors.border}`,
              background: colors.surfaceMuted,
              overflow: "hidden"
            }
      }
    >
      <summary
        className="scanner-collapsible__summary"
        onClick={() => {
          const el = detailsRef.current;
          if (el) persistOpenState(!el.open);
        }}
      >
        <span className="scanner-collapsible__chevron" aria-hidden>
          <ChevronRight size={16} strokeWidth={2.25} />
        </span>
        <span className="scanner-collapsible__labels">
          <span
            className="scanner-collapsible__title"
            style={{
              display: "block",
              fontSize: typography.scale.sm,
              fontWeight: 600,
              color: colors.text,
              lineHeight: 1.3
            }}
          >
            {title}
          </span>
          {hint ? (
            <span
              className="scanner-collapsible__hint"
              style={{
                display: "block",
                marginTop: 2,
                fontSize: typography.scale.xs,
                color: colors.textMuted,
                lineHeight: 1.35
              }}
            >
              {hint}
            </span>
          ) : null}
        </span>
      </summary>
      <div className="scanner-collapsible__body" style={{ padding: embedded ? `0 0 ${spacing[2]}` : spacing[3] }}>
        {children}
      </div>
    </details>
  );
}
