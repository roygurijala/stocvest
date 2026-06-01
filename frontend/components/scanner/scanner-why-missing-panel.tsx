"use client";

import { useEffect, useMemo, useState } from "react";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

export type ScannerMissingSample = {
  symbol: string;
  reason: string;
};

type Props = {
  rejectedSamples: ScannerMissingSample[];
  rejectionReasonCounts?: Record<string, number>;
  suggestedSymbols?: string[];
  prefillSymbol?: string | null;
};

function humanizeReason(reason: string): string {
  const raw = reason.trim();
  if (!raw) return "Not eligible this cycle.";
  const volumeDay = raw.match(/^day_volume_below_(\d+)$/);
  if (volumeDay) {
    const n = Number(volumeDay[1]);
    return `Day volume below ${n.toLocaleString()} shares minimum.`;
  }
  const volumePrev = raw.match(/^prev_day_volume_below_(\d+)$/);
  if (volumePrev) {
    const n = Number(volumePrev[1]);
    return `Average daily volume below ${n.toLocaleString()} shares minimum.`;
  }
  const gapBelow = raw.match(/^gap_below_([0-9.]+)pct$/);
  if (gapBelow) {
    return `Gap magnitude below ${gapBelow[1]}% threshold.`;
  }
  if (raw === "corporate_action_artifact") return "Excluded due to likely split/corporate-action distortion.";
  if (raw === "invalid_prev_close") return "Previous close is invalid or unavailable.";
  if (raw === "missing_session_price") return "Session price is unavailable.";
  if (raw.includes("below") || raw.includes("minimum") || raw.includes("split")) return raw;
  return raw.replace(/_/g, " ");
}

function topReasonRows(counts: Record<string, number> | undefined): Array<{ reason: string; count: number }> {
  if (!counts) return [];
  return Object.entries(counts)
    .filter(([, count]) => Number.isFinite(count) && count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([reason, count]) => ({ reason, count }));
}

export function ScannerWhyMissingPanel({
  rejectedSamples,
  rejectionReasonCounts,
  suggestedSymbols = [],
  prefillSymbol = null
}: Props) {
  const { colors } = useTheme();
  const [query, setQuery] = useState("");
  const normalized = query.trim().toUpperCase();

  const sampleBySymbol = useMemo(() => {
    const map = new Map<string, ScannerMissingSample>();
    for (const row of rejectedSamples) {
      const sym = row.symbol.trim().toUpperCase();
      if (!sym || map.has(sym)) continue;
      map.set(sym, { symbol: sym, reason: row.reason });
    }
    return map;
  }, [rejectedSamples]);

  const active = normalized ? sampleBySymbol.get(normalized) ?? null : null;
  const topReasons = useMemo(() => topReasonRows(rejectionReasonCounts), [rejectionReasonCounts]);
  const symbolOptions = useMemo(() => {
    const fromRejected = rejectedSamples.map((row) => row.symbol.trim().toUpperCase()).filter(Boolean);
    return [...new Set([...suggestedSymbols.map((s) => s.trim().toUpperCase()), ...fromRejected])].slice(0, 40);
  }, [suggestedSymbols, rejectedSamples]);

  useEffect(() => {
    const sym = String(prefillSymbol || "")
      .trim()
      .toUpperCase();
    if (!sym) return;
    setQuery(sym);
  }, [prefillSymbol]);

  return (
    <section
      id="scanner-why-missing-panel"
      data-testid="scanner-why-missing-panel"
      style={{
        padding: spacing[4],
        borderRadius: borderRadius.xl,
        border: `1px solid ${colors.border}`,
        background: colors.surface
      }}
    >
      <p
        style={{
          margin: `0 0 ${spacing[2]}`,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: colors.textMuted
        }}
      >
        Why missing
      </p>
      <p style={{ margin: `0 0 ${spacing[3]}`, fontSize: typography.scale.xs, color: colors.textMuted }}>
        Search a symbol to see the latest funnel rejection reason from the desk snapshot.
      </p>

      <label htmlFor="scanner-why-missing-input" style={{ display: "block", fontSize: typography.scale.xs, color: colors.text }}>
        Symbol
      </label>
      <input
        id="scanner-why-missing-input"
        data-testid="scanner-why-missing-input"
        list="scanner-why-missing-symbols"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="NVDA"
        style={{
          marginTop: spacing[1],
          width: "100%",
          borderRadius: borderRadius.md,
          border: `1px solid ${colors.border}`,
          background: colors.surfaceMuted,
          color: colors.text,
          fontSize: typography.scale.sm,
          padding: `${spacing[2]} ${spacing[2]}`
        }}
      />
      <datalist id="scanner-why-missing-symbols">
        {symbolOptions.map((sym) => (
          <option key={sym} value={sym} />
        ))}
      </datalist>

      {normalized ? (
        <div
          data-testid="scanner-why-missing-result"
          style={{
            marginTop: spacing[3],
            borderRadius: borderRadius.md,
            border: `1px solid ${colors.border}`,
            padding: spacing[3],
            background: colors.surfaceMuted
          }}
        >
          {active ? (
            <>
              <p style={{ margin: 0, fontSize: typography.scale.sm, fontWeight: 700, color: colors.text }}>
                {active.symbol} is currently filtered out
              </p>
              <p
                data-testid="scanner-why-missing-reason"
                style={{ margin: `${spacing[1]} 0 0`, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.45 }}
              >
                {humanizeReason(active.reason)}
              </p>
            </>
          ) : (
            <p
              data-testid="scanner-why-missing-not-found"
              style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.45 }}
            >
              {normalized} is not in the latest sampled rejections. It may be in the retained survivor pool or outside the current sample window.
            </p>
          )}
        </div>
      ) : null}

      {topReasons.length > 0 ? (
        <div style={{ marginTop: spacing[3] }}>
          <p style={{ margin: 0, fontSize: typography.scale.xs, fontWeight: 600, color: colors.text }}>
            Most common blockers this cycle
          </p>
          <ul style={{ margin: `${spacing[2]} 0 0`, padding: 0, listStyle: "none", display: "grid", gap: spacing[1] }}>
            {topReasons.map((row) => (
              <li key={row.reason} style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>
                {humanizeReason(row.reason)} ({row.count})
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
