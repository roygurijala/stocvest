"use client";

import { Zap } from "lucide-react";
import type { ReactNode } from "react";
import { SUBHEADING_DAY_CADENCE, SUBHEADING_SWING_CADENCE, TAB_LABEL_DAY, TAB_LABEL_SWING } from "@/lib/mode-terminology";
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";
import type { WatchlistMaturationLine } from "@/lib/hooks/use-watchlist-maturation-line";

type TradingMode = "day" | "swing";

type Props = {
  symbol: string;
  tradingMode: TradingMode;
  dayTradingSurfaces: boolean;
  watchlistControl: ReactNode;
  /** Scenario Builder CTA — sits beside watchlist under the symbol. */
  scenarioControl?: ReactNode;
  maturationLine: WatchlistMaturationLine | null;
  onTradingModeChange: (mode: TradingMode) => void;
};

export function SignalsCommandBar({
  symbol,
  tradingMode,
  dayTradingSurfaces,
  watchlistControl,
  scenarioControl,
  maturationLine,
  onTradingModeChange
}: Props) {
  const { colors } = useTheme();
  const symU = symbol.trim().toUpperCase();

  return (
    <article
      className={surfaceGlowClassName}
      data-testid="signals-command-bar"
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: borderRadius.xl,
        padding: spacing[4]
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2
            className="m-0 font-semibold tracking-tight"
            style={{ fontSize: typography.scale["2xl"], color: colors.text, lineHeight: 1.15 }}
          >
            {symU}
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
            {watchlistControl}
            {scenarioControl}
            {maturationLine ? (
              <span className="text-xs" style={{ color: colors.textMuted }} data-testid="signals-maturation-line">
                <span style={{ color: colors.text, fontWeight: 600 }}>{maturationLine.label}</span>
                {maturationLine.evaluatedAt ? <> · last evaluated {maturationLine.evaluatedAt}</> : null}
              </span>
            ) : null}
          </div>
        </div>
        {dayTradingSurfaces ? (
          <div
            className="grid shrink-0 grid-cols-2 gap-1 rounded-lg p-1"
            style={{ border: `1px solid ${colors.border}`, background: colors.background, minWidth: 200 }}
            role="tablist"
            aria-label="Trading mode"
          >
            <button
              type="button"
              role="tab"
              aria-selected={tradingMode === "day"}
              className="min-h-9 rounded-md px-2.5 text-xs font-semibold transition-colors"
              onClick={() => onTradingModeChange("day")}
              style={{
                background: tradingMode === "day" ? "rgba(0,200,220,0.25)" : "transparent",
                color: tradingMode === "day" ? "#00C8DC" : colors.textMuted,
                border: tradingMode === "day" ? "1px solid rgba(0,200,220,0.45)" : "1px solid transparent"
              }}
            >
              <span className="inline-flex items-center justify-center gap-1">
                <Zap size={14} aria-hidden />
                {TAB_LABEL_DAY}
              </span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tradingMode === "swing"}
              className="min-h-9 rounded-md px-2.5 text-xs font-semibold transition-colors"
              onClick={() => onTradingModeChange("swing")}
              style={{
                background: tradingMode === "swing" ? "rgba(168,85,247,0.22)" : "transparent",
                color: tradingMode === "swing" ? "#A855F7" : colors.textMuted,
                border: tradingMode === "swing" ? "1px solid rgba(168,85,247,0.45)" : "1px solid transparent"
              }}
            >
              {TAB_LABEL_SWING}
            </button>
          </div>
        ) : (
          <span
            className="inline-flex min-h-9 shrink-0 items-center rounded-lg px-3 text-xs font-semibold"
            style={{
              border: "1px solid rgba(168,85,247,0.45)",
              background: "rgba(168,85,247,0.15)",
              color: "#A855F7"
            }}
          >
            {TAB_LABEL_SWING} (your plan)
          </span>
        )}
      </div>
      <p className="m-0 mt-3 text-xs leading-relaxed" style={{ color: colors.textMuted }}>
        <strong style={{ color: colors.text, fontWeight: 600 }}>
          Mode: {tradingMode === "day" ? TAB_LABEL_DAY : TAB_LABEL_SWING}
        </strong>
        {" · "}
        {tradingMode === "day" ? SUBHEADING_DAY_CADENCE : SUBHEADING_SWING_CADENCE}
        <br />
        {tradingMode === "day"
          ? "Evaluated on live session structure · valid through regular session close."
          : "Evaluated on daily close · horizon ~5 calendar days."}
      </p>
    </article>
  );
}
