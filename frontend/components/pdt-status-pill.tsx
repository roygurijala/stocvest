"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PDTAssessmentPayload } from "@/lib/api/pdt";
import type { ThemeColors } from "@/lib/design-system";
import { typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";
import { useIsMobileLayout } from "@/lib/hooks/use-is-mobile-layout";
import { PDT_GUARDIAN_TIP } from "@/lib/ui-tooltips";

function withAlpha(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${a})`;
}

export type PdtPillStyle = {
  color: string;
  bg: string;
  border: string;
  icon: string;
  label: string;
  title: string;
};

function resetLabel(days: number): string {
  return days === 1 ? "Resets in 1 day." : `Resets in ${days} days.`;
}

/** Color bands: green 0–1 used (below max−1), amber at max−1, red at max (uses theme tokens). */
export function getPdtStyle(used: number, max: number, daysUntilReset: number, colors: ThemeColors): PdtPillStyle {
  const maxSafe = Math.max(1, max);
  const u = Math.max(0, Math.min(used, maxSafe));
  const reset = resetLabel(Math.max(0, daysUntilReset));

  if (u >= maxSafe) {
    return {
      color: colors.bearish,
      bg: withAlpha(colors.bearish, 0.12),
      border: withAlpha(colors.bearish, 0.3),
      icon: "🚫",
      label: `PDT ${u}/${maxSafe}`,
      title: `Day trade limit reached.\n${reset}`
    };
  }
  if (maxSafe >= 2 && u >= maxSafe - 1) {
    return {
      color: colors.caution,
      bg: withAlpha(colors.caution, 0.12),
      border: withAlpha(colors.caution, 0.3),
      icon: "⚠️",
      label: `PDT ${u}/${maxSafe}`,
      title: `1 day trade remaining this week.\n${reset}`
    };
  }
  return {
    color: colors.bullish,
    bg: withAlpha(colors.bullish, 0.12),
    border: withAlpha(colors.bullish, 0.3),
    icon: "🛡",
    label: `PDT ${u}/${maxSafe}`,
    title: `Day trade count clear.\n${reset}`
  };
}

function mobileDetailLines(used: number, max: number, daysUntilReset: number): string {
  const maxSafe = Math.max(1, max);
  const u = Math.max(0, Math.min(used, maxSafe));
  const reset = daysUntilReset === 1 ? "Resets in 1 day." : `Resets in ${daysUntilReset} days.`;
  return `${u} of ${maxSafe} day trades used this week.\n\n${reset}\n\nPattern Day Trader rule applies to accounts under $25,000.\n\n${PDT_GUARDIAN_TIP}`;
}

type Props = {
  assessment: PDTAssessmentPayload | null;
};

export function PdtStatusPill({ assessment }: Props) {
  const { colors } = useTheme();
  const mobile = useIsMobileLayout();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open || !mobile) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, mobile, close]);

  if (!assessment) {
    return (
      <div
        title="Connect a broker to enable pattern day trade tracking."
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          padding: "4px 10px",
          borderRadius: 20,
          border: `1px solid ${colors.border}`,
          backgroundColor: colors.surfaceMuted,
          cursor: "default",
          fontSize: "0.75rem",
          fontWeight: 600,
          color: colors.textMuted,
          whiteSpace: "nowrap"
        }}
      >
        <span>🛡</span>
        <span>PDT —</span>
      </div>
    );
  }

  const used = assessment.current_day_trade_count;
  const max = assessment.max_non_exempt;
  const days = assessment.days_until_reset;
  const style = getPdtStyle(used, max, days, colors);
  const detail = mobileDetailLines(used, max, days);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        aria-expanded={mobile ? open : undefined}
        title={mobile ? undefined : style.title.replace(/\n/g, " ")}
        onClick={() => mobile && setOpen((o) => !o)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          padding: "4px 10px",
          borderRadius: 20,
          border: `1px solid ${style.border}`,
          backgroundColor: style.bg,
          cursor: mobile ? "pointer" : "default",
          fontSize: "0.75rem",
          fontWeight: 600,
          color: style.color,
          whiteSpace: "nowrap",
          fontFamily: "inherit"
        }}
      >
        <span aria-hidden>{style.icon}</span>
        <span>{style.label}</span>
      </button>
      {mobile && open ? (
        <div
          role="dialog"
          aria-label="Pattern day trader status"
          className="absolute left-0 top-full z-20 mt-1 max-w-[min(100vw-2rem,320px)] rounded-lg border p-3 text-left shadow-lg"
          style={{
            borderColor: colors.border,
            background: colors.surface,
            color: colors.text,
            fontSize: typography.scale.sm,
            lineHeight: 1.5,
            whiteSpace: "pre-wrap"
          }}
        >
          {detail}
        </div>
      ) : null}
    </div>
  );
}
