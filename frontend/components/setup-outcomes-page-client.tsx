"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { fetchSetupOutcomes, type SetupOutcomesResponse } from "@/lib/api/setup-outcomes";
import { SetupOutcomesDashboard } from "@/components/setup-outcomes/setup-outcomes-dashboard";
import { EMPTY_VALIDATION } from "@/lib/product-empty-states";
import { DeskModeTabNav } from "@/components/desk-mode-tab-nav";
import { borderRadius, spacing, surfaceGlowClassName } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";
import { usePublishAssistantContext } from "@/lib/assistant/context";

type Mode = "swing" | "day";

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

  const building = data?.stats.building_dataset ?? true;

  return (
    <section style={{ display: "grid", gap: spacing[4] }} data-testid="setup-outcomes-page">
      <header>
        <h1 className="m-0 text-2xl font-semibold" style={{ color: colors.text }}>
          Setup outcomes
        </h1>
        <p className="m-0 mt-2 max-w-2xl text-sm leading-relaxed" style={{ color: colors.textMuted }}>
          How setups on your watchlist behaved across sessions — observational only, not trade performance or win
          rate. Open any symbol in{" "}
          <Link href="/dashboard" className="font-medium hover:underline" style={{ color: colors.accent }}>
            Trading Room
          </Link>{" "}
          for the live deep-dive.
        </p>
      </header>

      <p className="m-0 text-xs leading-relaxed" style={{ color: colors.textMuted }} data-testid="setup-outcomes-product-kpi-callout">
        <span className="font-semibold" style={{ color: colors.text }}>
          Not Product KPI.
        </span>{" "}
        For qualified actionable signal accuracy, see{" "}
        <Link href="/performance" className="font-medium hover:underline" style={{ color: colors.accent }}>
          Signal tracking → Product signal accuracy
        </Link>
        .
      </p>

      <DeskModeTabNav
        value={mode}
        onChange={setMode}
        modes={["swing", "day"] as const}
        ariaLabel="Setup outcomes desk"
        testIdPrefix="setup-outcomes-mode"
      />

      {data === undefined ? (
        <p className="text-sm" style={{ color: colors.textMuted }}>
          Loading outcomes…
        </p>
      ) : data === null ? (
        <p className="text-sm" style={{ color: colors.textMuted }}>
          Sign in to view setup outcomes for your watchlist.
        </p>
      ) : building ? (
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
            {EMPTY_VALIDATION.hint} ({data.stats.total_events}/5 session pairs collected)
          </p>
        </article>
      ) : (
        <SetupOutcomesDashboard data={data} mode={mode} />
      )}

      {data && !building ? (
        <p className="m-0 text-xs leading-relaxed" style={{ color: colors.textMuted }}>
          {data.disclaimer}
        </p>
      ) : null}

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
    </section>
  );
}
