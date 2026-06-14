"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { SetupOutcomeEvent, SetupOutcomesResponse } from "@/lib/api/setup-outcomes";
import { signalsWithSymbolHref } from "@/lib/nav/setup-analytics-deeplink";
import { borderRadius, spacing } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";
import {
  OUTCOME_BADGE,
  OUTCOME_LABEL,
  biasConfirmedEvents,
  buildDonutSegments,
  filterOutcomeEvents,
  formatSessionDateLabel,
  groupOutcomeEventsBySymbol,
  layerDeltaLabel,
  searchOutcomeEvents,
  sortOutcomeEvents,
  type OutcomeFilter,
  type OutcomeSort,
  type OutcomeView,
  type DonutSegment
} from "@/lib/setup-outcomes-present";

function MiniLayerBar({
  aligned,
  total,
  nextAligned
}: {
  aligned: number;
  total: number;
  nextAligned: number | null;
}) {
  const { colors } = useTheme();
  const target = nextAligned ?? aligned;
  return (
    <span className="inline-flex items-center gap-1" aria-hidden>
      {Array.from({ length: total }, (_, i) => {
        const before = i < aligned;
        const after = nextAligned != null && i < target;
        const changed = nextAligned != null && before !== after && i < Math.max(aligned, target);
        let bg = "rgba(148,163,184,0.22)";
        if (after) bg = colors.bullish;
        else if (before && nextAligned != null && !after) bg = colors.caution;
        else if (before) bg = colors.bullish;
        return (
          <span
            key={i}
            style={{
              width: 8,
              height: 5,
              borderRadius: 999,
              background: bg,
              boxShadow: changed ? `0 0 4px ${colors.caution}` : undefined
            }}
          />
        );
      })}
    </span>
  );
}

function OutcomeDonut({ segments, total }: { segments: DonutSegment[]; total: number }) {
  const { colors } = useTheme();
  if (total <= 0) {
    return (
      <div
        className="flex h-20 w-20 items-center justify-center rounded-full text-xs"
        style={{ border: `2px dashed ${colors.border}`, color: colors.textMuted }}
      >
        —
      </div>
    );
  }
  let offset = 0;
  const stops = segments
    .map((s) => {
      const pct = (s.count / total) * 100;
      const start = offset;
      offset += pct;
      return `${s.color} ${start}% ${offset}%`;
    })
    .join(", ");
  return (
    <div
      className="h-20 w-20 shrink-0 rounded-full"
      style={{ background: `conic-gradient(${stops})` }}
      role="img"
      aria-label={`Outcome breakdown: ${segments.map((s) => `${s.label} ${s.count}`).join(", ")}`}
    />
  );
}

function badgeStyle(tone: (typeof OUTCOME_BADGE)[string]["tone"], colors: ReturnType<typeof useTheme>["colors"]) {
  const map = {
    bullish: { bg: "rgba(34,197,94,0.12)", color: colors.bullish, border: "rgba(34,197,94,0.35)" },
    caution: { bg: "rgba(245,158,11,0.12)", color: colors.caution, border: "rgba(245,158,11,0.35)" },
    bearish: { bg: "rgba(239,68,68,0.12)", color: colors.bearish, border: "rgba(239,68,68,0.35)" },
    accent: { bg: "rgba(59,130,246,0.12)", color: colors.accent, border: "rgba(59,130,246,0.35)" },
    muted: { bg: "rgba(148,163,184,0.12)", color: colors.textMuted, border: colors.border }
  };
  return map[tone];
}

function OutcomeBadge({ kind }: { kind: string }) {
  const { colors } = useTheme();
  const meta = OUTCOME_BADGE[kind] ?? OUTCOME_BADGE.insufficient_data;
  const s = badgeStyle(meta.tone, colors);
  return (
    <span
      className="inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
      style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}` }}
    >
      {meta.label}
    </span>
  );
}

function EventRow({ event, mode }: { event: SetupOutcomeEvent; mode: "swing" | "day" }) {
  const { colors } = useTheme();
  return (
    <li className="flex flex-wrap items-center gap-2 text-sm" style={{ color: colors.text }}>
      <span style={{ color: colors.textMuted, minWidth: 52 }}>{formatSessionDateLabel(event.session_date)}</span>
      <OutcomeBadge kind={event.outcome_kind} />
      <span>{OUTCOME_LABEL[event.outcome_kind] ?? event.outcome_kind}</span>
      <MiniLayerBar
        aligned={event.layers_aligned}
        total={event.layers_total}
        nextAligned={event.next_layers_aligned}
      />
      <span className="text-xs tabular-nums" style={{ color: colors.textMuted }}>
        {layerDeltaLabel(event)}/{event.layers_total}
      </span>
      <Link
        href={signalsWithSymbolHref(event.symbol, mode, "setup-outcomes")}
        className="setup-outcomes-event-link ml-auto text-xs font-medium no-underline hover:underline"
        style={{ color: colors.accent }}
      >
        Open in Trading Room
      </Link>
    </li>
  );
}

type Props = {
  data: SetupOutcomesResponse;
  mode: "swing" | "day";
};

export function SetupOutcomesDashboard({ data, mode }: Props) {
  const { colors } = useTheme();
  const [filter, setFilter] = useState<OutcomeFilter>("all");
  const [sort, setSort] = useState<OutcomeSort>("date_desc");
  const [view, setView] = useState<OutcomeView>("by_symbol");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    let rows = filterOutcomeEvents(data.events, filter);
    rows = searchOutcomeEvents(rows, query);
    return sortOutcomeEvents(rows, sort);
  }, [data.events, filter, query, sort]);

  const groups = useMemo(() => groupOutcomeEventsBySymbol(filtered), [filtered]);
  const highlights = useMemo(() => biasConfirmedEvents(data.events), [data.events]);
  const donut = buildDonutSegments(data.stats.by_kind, {
    bullish: colors.bullish,
    caution: colors.caution,
    accent: colors.accent
  });
  const heldRate = data.stats.alignment_held_rate;
  const continuation = data.stats.setup_continuation_rate;
  const biasConfirmedCount = data.stats.by_kind.setup_continuation ?? 0;

  const FILTERS: { id: OutcomeFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "bias_confirmed", label: "Bias confirmed" },
    { id: "improved", label: "Improved" },
    { id: "held", label: "Held" },
    { id: "weakened", label: "Weakened" }
  ];

  return (
    <div className="grid gap-4" data-testid="setup-outcomes-dashboard">
      <div className="grid gap-3 lg:grid-cols-4">
        <StatTile label="Session pairs" value={String(data.stats.total_events)} hint="Consecutive evaluations" />
        <div
          className="grid gap-2 sm:grid-cols-[auto_1fr] sm:items-center lg:col-span-2"
          style={{
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: borderRadius.lg,
            padding: spacing[3]
          }}
        >
          <OutcomeDonut segments={donut} total={data.stats.total_events} />
          <div>
            <p className="m-0 text-[10px] font-semibold uppercase tracking-wide" style={{ color: colors.textMuted }}>
              Outcome breakdown
            </p>
            <ul className="m-0 mt-2 flex flex-wrap gap-3 p-0 list-none text-xs" style={{ color: colors.text }}>
              {donut.map((s) => (
                <li key={s.id}>
                  <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />
                  {s.label} {s.count}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <StatTile
          label="Alignment held rate"
          value={heldRate != null ? `${heldRate}%` : "—"}
          hint="Layer count held or improved next session"
          progress={heldRate ?? undefined}
        />
      </div>

      <article
        style={{
          background: "rgba(245,158,11,0.06)",
          border: `1px solid rgba(245,158,11,0.35)`,
          borderRadius: borderRadius.xl,
          padding: spacing[3]
        }}
        data-testid="setup-outcomes-bias-highlight"
      >
        <p className="m-0 text-[10px] font-semibold uppercase tracking-wide" style={{ color: colors.caution }}>
          Price moved with bias
        </p>
        <p className="m-0 mt-1 text-2xl font-bold tabular-nums" style={{ color: colors.text }}>
          {biasConfirmedCount}
        </p>
        <p className="m-0 mt-1 text-xs" style={{ color: colors.textMuted }}>
          Strongest setup-quality signal
          {continuation != null ? ` · ${continuation}% of session pairs` : ""}
        </p>
        {highlights.length > 0 ? (
          <ul className="m-0 mt-3 grid gap-2 p-0 list-none">
            {highlights.map((e) => (
              <li key={`${e.symbol}-${e.session_date}`} className="flex flex-wrap items-center gap-2 text-sm">
                <Link href={signalsWithSymbolHref(e.symbol, mode, "setup-outcomes")} style={{ color: colors.accent, fontWeight: 600 }}>
                  {e.symbol}
                </Link>
                <span style={{ color: colors.textMuted }}>{formatSessionDateLabel(e.session_date)}</span>
                <span style={{ color: colors.text }}>{OUTCOME_LABEL[e.outcome_kind]}</span>
                <MiniLayerBar aligned={e.layers_aligned} total={e.layers_total} nextAligned={e.next_layers_aligned} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 mt-2 text-sm" style={{ color: colors.textMuted }}>
            No bias-confirmed session pairs in this window yet.
          </p>
        )}
      </article>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          placeholder="Search symbol…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="min-w-[140px] flex-1 rounded-md border px-3 py-2 text-sm"
          style={{ borderColor: colors.border, background: colors.surface, color: colors.text }}
          data-testid="setup-outcomes-search"
        />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as OutcomeSort)}
          className="rounded-md border px-2 py-2 text-sm"
          style={{ borderColor: colors.border, background: colors.surface, color: colors.text }}
          aria-label="Sort outcomes"
        >
          <option value="date_desc">Sort: Date (newest)</option>
          <option value="date_asc">Sort: Date (oldest)</option>
          <option value="symbol">Sort: Symbol</option>
        </select>
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className="rounded-full border px-2.5 py-1 text-xs font-semibold"
              style={{
                borderColor: filter === f.id ? colors.accent : colors.border,
                background: filter === f.id ? "rgba(59,130,246,0.12)" : colors.surface,
                color: filter === f.id ? colors.accent : colors.textMuted
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex rounded-md border p-0.5 text-xs" style={{ borderColor: colors.border }}>
          {(["by_symbol", "flat"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className="rounded px-2 py-1 font-semibold"
              style={{
                background: view === v ? colors.surfaceMuted : "transparent",
                color: view === v ? colors.text : colors.textMuted
              }}
            >
              {v === "by_symbol" ? "By symbol" : "Flat list"}
            </button>
          ))}
        </div>
      </div>

      <article
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: borderRadius.xl,
          padding: spacing[4]
        }}
        data-testid="setup-outcomes-list"
      >
        {filtered.length === 0 ? (
          <p className="m-0 text-sm" style={{ color: colors.textMuted }}>
            No session pairs match this filter.
          </p>
        ) : view === "flat" ? (
          <ul className="m-0 space-y-3 p-0 list-none">
            {filtered.map((e) => (
              <EventRow key={`${e.symbol}-${e.session_date}-${e.outcome_kind}`} event={e} mode={mode} />
            ))}
          </ul>
        ) : (
          <ul className="m-0 space-y-4 p-0 list-none">
            {groups.map((g) => (
              <li key={g.symbol}>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Link
                    href={signalsWithSymbolHref(g.symbol, mode, "setup-outcomes")}
                    className="text-base font-semibold no-underline hover:underline"
                    style={{ color: colors.accent }}
                  >
                    {g.symbol}
                  </Link>
                  <OutcomeBadge kind={g.events[0]?.outcome_kind ?? "insufficient_data"} />
                  <span className="text-xs" style={{ color: colors.textMuted }}>
                    {g.events.length} session pair{g.events.length === 1 ? "" : "s"}
                  </span>
                </div>
                <ul className="m-0 space-y-2 border-l-2 pl-3 list-none" style={{ borderColor: colors.border }}>
                  {g.events.map((e) => (
                    <EventRow key={`${e.symbol}-${e.session_date}`} event={e} mode={mode} />
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </article>
    </div>
  );
}

function StatTile({
  label,
  value,
  hint,
  progress
}: {
  label: string;
  value: string;
  hint: string;
  progress?: number;
}) {
  const { colors } = useTheme();
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
      {progress != null ? (
        <div
          className="mt-2 h-1.5 w-full overflow-hidden rounded-full"
          style={{ background: "rgba(148,163,184,0.2)" }}
        >
          <div className="h-full rounded-full" style={{ width: `${Math.min(100, progress)}%`, background: colors.bullish }} />
        </div>
      ) : null}
      <p className="m-0 mt-1 text-xs" style={{ color: colors.textMuted }}>
        {hint}
      </p>
    </div>
  );
}
