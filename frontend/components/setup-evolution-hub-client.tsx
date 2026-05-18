"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { SetupEvolutionPanel } from "@/components/signals/setup-evolution-panel";
import { MaturationFrequencyCallout } from "@/components/maturation-frequency-callout";
import { setupEvolutionHubIntro } from "@/lib/maturation-expected-frequency";
import { setupOutcomesHref } from "@/lib/nav/setup-analytics-deeplink";
import { borderRadius, roleAccents, spacing } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";
import { usePublishAssistantContext } from "@/lib/assistant/context";

type Mode = "swing" | "day";

function parseMode(raw: string | null): Mode {
  return raw === "day" ? "day" : "swing";
}

export function SetupEvolutionHubClient() {
  const searchParams = useSearchParams();
  const { colors, theme } = useTheme();
  const [mode, setMode] = useState<Mode>(() => parseMode(searchParams.get("trading_mode")));
  const [symbols, setSymbols] = useState<string[]>([]);
  const [symbol, setSymbol] = useState(() => (searchParams.get("symbol") ?? "").trim().toUpperCase());

  const loadSymbols = useCallback(async () => {
    try {
      const res = await fetch("/api/stocvest/watchlists/default/symbols", { cache: "no-store" });
      if (!res.ok) return;
      const j = (await res.json()) as { symbols?: string[] };
      const list = (j.symbols ?? []).map((s) => String(s).trim().toUpperCase()).filter(Boolean);
      setSymbols(list);
      setSymbol((prev) => (prev && list.includes(prev) ? prev : list[0] ?? ""));
    } catch {
      setSymbols([]);
    }
  }, []);

  useEffect(() => {
    void loadSymbols();
  }, [loadSymbols]);

  useEffect(() => {
    const m = parseMode(searchParams.get("trading_mode"));
    setMode(m);
    const sym = (searchParams.get("symbol") ?? "").trim().toUpperCase();
    if (sym) setSymbol(sym);
  }, [searchParams]);

  usePublishAssistantContext({ page: "dashboard/setup-evolution", trading_mode: mode });

  const accent = roleAccents[theme][mode];

  return (
    <section style={{ display: "grid", gap: spacing[4] }} data-testid="setup-evolution-hub">
      <header>
        <h1 className="m-0 text-2xl font-semibold" style={{ color: colors.text }}>
          Setup evolution
        </h1>
        <p className="m-0 mt-2 max-w-2xl text-sm leading-relaxed" style={{ color: colors.textMuted }}>
          How maturation states changed on your watchlist over time — not signal accuracy or trade results. Session-pair
          outcomes live on{" "}
          <Link href={setupOutcomesHref(mode)} className="font-medium hover:underline" style={{ color: colors.accent }}>
            Setup outcomes
          </Link>
          .
        </p>
        <p
          className="m-0 mt-2 max-w-3xl text-xs leading-relaxed"
          style={{ color: colors.textMuted }}
          data-testid="setup-evolution-hub-frequency-intro"
        >
          {setupEvolutionHubIntro(mode)}
        </p>
      </header>

      <MaturationFrequencyCallout desk={mode} showDisplayBands testId="setup-evolution-hub-frequency" />

      <div className="flex flex-wrap gap-2">
        {(["swing", "day"] as const).map((m) => (
          <button
            key={m}
            type="button"
            data-testid={`setup-evolution-hub-mode-${m}`}
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

      {symbols.length === 0 ? (
        <p className="text-sm" style={{ color: colors.textMuted }}>
          Add symbols to your{" "}
          <Link href="/dashboard/watchlists" className="font-medium hover:underline" style={{ color: colors.accent }}>
            default watchlist
          </Link>{" "}
          to track setup evolution.
        </p>
      ) : (
        <>
          <label className="flex flex-col gap-1 text-sm" style={{ color: colors.textMuted }}>
            Symbol
            <select
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              className="min-h-11 max-w-xs rounded-md px-3"
              style={{
                border: `1px solid ${colors.border}`,
                background: colors.surface,
                color: colors.text
              }}
            >
              {symbols.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          {symbol ? <SetupEvolutionPanel symbol={symbol} tradingMode={mode} showSummary /> : null}
        </>
      )}
    </section>
  );
}
