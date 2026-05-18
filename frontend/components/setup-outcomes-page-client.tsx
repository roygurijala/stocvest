"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { fetchSetupOutcomes, type SetupOutcomesResponse } from "@/lib/api/setup-outcomes";
import { SetupSystemBehaviorCard } from "@/components/setup-system-behavior-card";
import { EMPTY_VALIDATION } from "@/lib/product-empty-states";
import { borderRadius, roleAccents, spacing, surfaceGlowClassName } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";
import { usePublishAssistantContext } from "@/lib/assistant/context";

type Mode = "swing" | "day";

const OUTCOME_LABEL: Record<string, string> = {
  alignment_held: "Alignment held next session",
  alignment_weakened: "Alignment weakened",
  state_improved: "State improved",
  state_worsened: "State weakened",
  setup_continuation: "Alignment held + price moved with bias",
  insufficient_data: "Insufficient follow-up"
};

function parseMode(raw: string | null): Mode {
  return raw === "day" ? "day" : "swing";
}

export function SetupOutcomesPageClient({ isAdmin = false }: { isAdmin?: boolean }) {
  const searchParams = useSearchParams();
  const { colors, theme } = useTheme();
  const [mode, setMode] = useState<Mode>(() => parseMode(searchParams.get("trading_mode")));
  const [data, setData] = useState<SetupOutcomesResponse | null | undefined>(undefined);

  useEffect(() => {
    setMode(parseMode(searchParams.get("trading_mode")));
  }, [searchParams]);

  useEffect(() => {
    let active = true;
    setData(undefined);
    void fetchSetupOutcomes(mode, 30).then((res) => {
      if (active) setData(res);
    });
    return () => {
      active = false;
    };
  }, [mode]);

  usePublishAssistantContext({ page: "dashboard/setup-outcomes", trading_mode: mode });

  const accent = roleAccents[theme][mode];
  const building = data?.stats.building_dataset ?? true;

  return (
    <section style={{ display: "grid", gap: spacing[4] }} data-testid="setup-outcomes-page">
      <header>
        <h1 className="m-0 text-2xl font-semibold" style={{ color: colors.text }}>
          Setup outcomes
        </h1>
        <p className="m-0 mt-2 max-w-2xl text-sm leading-relaxed" style={{ color: colors.textMuted }}>
          How setups on your watchlist behaved across sessions — observational only, not trade performance or win
          rate.
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        {(["swing", "day"] as const).map((m) => (
          <button
            key={m}
            type="button"
            data-testid={`setup-outcomes-mode-${m}`}
            className="min-h-11 rounded-md px-4 text-sm capitalize"
            aria-pressed={mode === m}
            onClick={() => setMode(m)}
            style={{
              border: `1px solid ${mode === m ? accent.borderAccent : colors.border}`,
              background: mode === m ? `${accent.accent}22` : "transparent",
              color: mode === m ? accent.accentStrong : colors.textMuted
            }}
          >
            {m}
          </button>
        ))}
      </div>

      {data === undefined ? (
        <p className="text-sm" style={{ color: colors.textMuted }}>
          Loading outcomes…
        </p>
      ) : data === null ? (
        <p className="text-sm" style={{ color: colors.textMuted }}>
          Sign in to view setup outcomes for your watchlist.
        </p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard
              label="Session pairs"
              value={String(data.stats.total_events)}
              hint="Consecutive evaluations on your default watchlist"
              colors={colors}
            />
            <StatCard
              label="Alignment held"
              value={data.stats.alignment_held_rate != null ? `${data.stats.alignment_held_rate}%` : "—"}
              hint="Next session kept or improved layer count"
              colors={colors}
            />
            <StatCard
              label="Symbols"
              value={String(data.stats.symbols_with_events)}
              hint={`${data.watchlist_symbol_count} on watchlist`}
              colors={colors}
            />
          </div>

          {building ? (
            <article
              className={surfaceGlowClassName}
              data-testid="setup-outcomes-building"
              style={{
                background: colors.surface,
                border: `1px solid ${colors.border}`,
                borderRadius: borderRadius.xl,
                padding: spacing[4]
              }}
            >
              <p className="m-0 font-semibold" style={{ color: colors.text }}>
                {EMPTY_VALIDATION.title}
              </p>
              <p className="m-0 mt-2 text-sm leading-relaxed" style={{ color: colors.textMuted }}>
                {EMPTY_VALIDATION.body}
              </p>
              <p className="m-0 mt-2 text-xs" style={{ color: colors.textMuted }}>
                {EMPTY_VALIDATION.hint}
              </p>
            </article>
          ) : (
            <SetupSystemBehaviorCard data={data} />
          )}

          {data.events.length > 0 ? (
            <article
              className={surfaceGlowClassName}
              style={{
                background: colors.surface,
                border: `1px solid ${colors.border}`,
                borderRadius: borderRadius.xl,
                padding: spacing[4]
              }}
            >
              <h2 className="m-0 text-lg font-semibold" style={{ color: colors.text }}>
                Recent session pairs
              </h2>
              <ul className="mt-3 list-none space-y-2 p-0">
                {data.events.slice(0, 25).map((e) => (
                  <li
                    key={`${e.symbol}-${e.session_date}-${e.outcome_kind}`}
                    className="flex flex-wrap gap-2 text-sm"
                    style={{ color: colors.text }}
                  >
                    <Link
                      href={`/dashboard/signals?symbol=${encodeURIComponent(e.symbol)}&trading_mode=${mode}`}
                      className="font-medium no-underline hover:underline"
                      style={{ color: colors.accent }}
                    >
                      {e.symbol}
                    </Link>
                    <span style={{ color: colors.textMuted }}>{e.session_date}</span>
                    <span>·</span>
                    <span>{OUTCOME_LABEL[e.outcome_kind] ?? e.outcome_kind}</span>
                    <span style={{ color: colors.textMuted }}>
                      ({e.layers_aligned}/{e.layers_total} →{" "}
                      {e.next_layers_aligned != null ? `${e.next_layers_aligned}/${e.layers_total}` : "—"})
                    </span>
                  </li>
                ))}
              </ul>
            </article>
          ) : null}

          <p className="m-0 text-xs leading-relaxed" style={{ color: colors.textMuted }}>
            {data.disclaimer}
          </p>
          {isAdmin ? (
            <p className="m-0 text-xs" style={{ color: colors.textMuted }}>
              Operators:{" "}
              <Link
                href="/dashboard/admin/historical-validation"
                className="font-medium hover:underline"
                style={{ color: colors.accent }}
                data-testid="setup-outcomes-admin-d2-link"
              >
                D2 stratified validation (SignalHistory)
              </Link>
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

function StatCard({
  label,
  value,
  hint,
  colors
}: {
  label: string;
  value: string;
  hint: string;
  colors: { surface: string; border: string; text: string; textMuted: string };
}) {
  return (
    <div
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: borderRadius.lg,
        padding: spacing[3]
      }}
    >
      <p className="m-0 text-[10px] font-semibold uppercase tracking-wide" style={{ color: colors.textMuted }}>
        {label}
      </p>
      <p className="m-0 mt-1 text-xl font-semibold tabular-nums" style={{ color: colors.text }}>
        {value}
      </p>
      <p className="m-0 mt-1 text-xs" style={{ color: colors.textMuted }}>
        {hint}
      </p>
    </div>
  );
}
