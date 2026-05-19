"use client";

import { useState } from "react";
import { borderRadius, spacing, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";
import { parseUnlockForecast, type UnlockHint } from "@/lib/laggard";

type UnlockForecastProps = {
  hints?: UnlockHint[] | null;
  /** When true, loads swing composite unlock_forecast on first expand. */
  fetchOnExpand?: boolean;
  symbol?: string;
};

export function UnlockForecast({ hints: hintsProp, fetchOnExpand = false, symbol }: UnlockForecastProps) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [hints, setHints] = useState<UnlockHint[] | null>(hintsProp ?? null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState(false);

  const resolved = hints ?? hintsProp ?? [];

  if (!fetchOnExpand && resolved.length === 0) {
    return null;
  }

  async function handleToggle() {
    const next = !open;
    setOpen(next);
    if (!next || resolved.length > 0 || !fetchOnExpand || !symbol?.trim()) return;
    setLoading(true);
    setFetchError(false);
    try {
      const res = await fetch("/api/stocvest/signals/composite/swing", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ symbol: symbol.trim().toUpperCase() })
      });
      if (!res.ok) {
        setFetchError(true);
        return;
      }
      const body = (await res.json()) as Record<string, unknown>;
      setHints(parseUnlockForecast(body.unlock_forecast));
    } catch {
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  }

  const displayHints = hints ?? hintsProp ?? [];
  const displayPrimary = displayHints.find((h) => h.is_primary_blocker) ?? displayHints[0];

  return (
    <div
      className="relative z-10 pointer-events-auto mt-2"
      data-testid="unlock-forecast"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="text-left text-xs font-medium hover:underline"
        style={{ color: colors.accent }}
        aria-expanded={open}
        onClick={() => void handleToggle()}
      >
        What would unlock this setup? {open ? "▲" : "▼"}
      </button>
      {open ? (
        <div
          data-testid="unlock-forecast-expanded"
          style={{
            marginTop: spacing[2],
            borderRadius: borderRadius.lg,
            border: `1px solid ${colors.border}`,
            padding: spacing[3],
            background: colors.surfaceMuted,
            display: "grid",
            gap: spacing[2]
          }}
        >
          {loading ? (
            <p className="m-0 text-xs" style={{ color: colors.textMuted }}>
              Loading layer unlock hints…
            </p>
          ) : fetchError ? (
            <p className="m-0 text-xs" style={{ color: colors.textMuted }}>
              Unlock forecast unavailable right now.
            </p>
          ) : displayPrimary ? (
            <article data-testid="unlock-forecast-primary">
              <p className="m-0 text-xs font-semibold uppercase tracking-wide" style={{ color: colors.textMuted }}>
                Primary blocker · {displayPrimary.layer_label}
              </p>
              <p className="m-0 mt-1 text-sm" style={{ color: colors.text }}>
                {displayPrimary.distance_description}
              </p>
              <p className="m-0 mt-2 text-sm" style={{ color: colors.text }}>
                <span style={{ fontWeight: 600 }}>Trigger:</span> {displayPrimary.trigger_condition}
              </p>
              {displayPrimary.estimated_sessions != null ? (
                <p className="m-0 mt-1 text-xs" style={{ color: colors.textMuted }}>
                  Estimated ~{displayPrimary.estimated_sessions} session
                  {displayPrimary.estimated_sessions === 1 ? "" : "s"} · {displayPrimary.confidence} confidence
                </p>
              ) : (
                <p className="m-0 mt-1 text-xs" style={{ color: colors.textMuted }}>
                  Timing uncertain · {displayPrimary.confidence} confidence
                </p>
              )}
            </article>
          ) : (
            <p className="m-0 text-xs" style={{ color: colors.textMuted }}>
              No unlock hints — aligned layers or unknowable blockers (news, geopolitical).
            </p>
          )}
          {displayHints.length > 1 ? (
            <ul className="m-0 list-none p-0" style={{ display: "grid", gap: spacing[1] }}>
              {displayHints.slice(1, 4).map((h) => (
                <li key={h.layer_name} className="text-xs" style={{ color: colors.textMuted }}>
                  <span style={{ fontWeight: 600, color: colors.text }}>{h.layer_label}:</span> {h.distance_description}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
