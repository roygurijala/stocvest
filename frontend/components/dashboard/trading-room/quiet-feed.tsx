"use client";

/**
 * Trading Room — quiet-session feed.
 *
 * When the desk has no qualified setups (a genuinely quiet tape), the signal
 * feed would otherwise be empty. Instead we surface two context lists so the
 * left panel still teaches the user what the desk is watching:
 *
 *   • Session activity  — today's bigger movers (desk movers radar).
 *   • Building structure — quiet leaders / low-velocity names whose structure
 *     is forming (reuses `resolveBuildingStructureRows`).
 *
 * Cards are compact and clickable: selecting one opens its Deep Dive via a
 * synthesized FeedCard (the composite fetch keys off symbol + lane).
 */

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { borderRadius, roleAccents, spacing, typography } from "@/lib/design-system";
import type { useTheme } from "@/lib/theme-provider";
import type { DeskTodayData } from "@/lib/api/desk-today";
import type { SnapshotPayload } from "@/lib/api/market";
import { resolveBuildingStructureRows } from "@/lib/dashboard/building-structure-present";
import { alignedLayersFromAlignmentRatio } from "@/lib/signals-page-present";
import type { FeedBias, FeedCard, FeedLane, FeedState } from "@/lib/dashboard/trading-room/feed-model";
import { useSymbolNames } from "@/lib/hooks/use-symbol-names";
import { FeedCardUpdatedLine } from "@/lib/dashboard/trading-room/feed-card-present";

type Colors = ReturnType<typeof useTheme>["colors"];

const LAYER_TOTAL = 6;

function stateTone(state: FeedState, colors: Colors): string {
  if (state === "actionable") return colors.bullish;
  if (state === "near") return colors.caution;
  if (state === "cooling") return colors.bearish;
  return colors.textMuted;
}

function biasFromDirection(direction: "up" | "down" | null | undefined): FeedBias {
  if (direction === "up") return "bull";
  if (direction === "down") return "bear";
  return "neutral";
}

function biasPillStyle(bias: FeedBias, colors: Colors): CSSProperties {
  const tone = bias === "bull" ? colors.bullish : bias === "bear" ? colors.bearish : colors.textMuted;
  return {
    display: "inline-block",
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: tone,
    background: `${tone}1f`,
    padding: "1px 6px",
    borderRadius: borderRadius.full
  };
}

interface QuietCardData {
  card: FeedCard;
  note: string;
}

function QuietCard({
  data,
  active,
  onSelect,
  colors
}: {
  data: QuietCardData;
  active: boolean;
  onSelect: (card: FeedCard) => void;
  colors: Colors;
}) {
  const { card } = data;
  const laneAccent =
    card.lane === "day" ? roleAccents.dark.day.borderAccent : roleAccents.dark.swing.borderAccent;
  const pct = card.changePct;
  const pctTone = pct == null ? colors.textMuted : pct >= 0 ? colors.bullish : colors.bearish;
  const sTone = stateTone(card.state, colors);
  return (
    <button
      type="button"
      onClick={() => onSelect(card)}
      style={{
        textAlign: "left",
        background: active ? colors.surfaceMuted : colors.surface,
        border: `1px solid ${active ? colors.accent : colors.border}`,
        borderLeft: `3px solid ${laneAccent}`,
        borderBottom: `3px solid ${sTone}`,
        borderRadius: borderRadius.md,
        padding: spacing[2],
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        gap: 3,
        color: colors.text
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: spacing[2] }}>
        <span style={{ fontSize: typography.scale.sm, fontWeight: 700 }}>{card.symbol}</span>
        <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
          <span style={{ fontSize: typography.scale.xs, fontWeight: 600, color: pctTone }}>
            {card.price != null ? `$${card.price.toFixed(2)}` : "—"}
          </span>
          {pct != null ? (
            <span style={{ fontSize: 9, color: pctTone }}>{`${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`}</span>
          ) : null}
        </span>
      </div>
      {card.company ? (
        <span style={{ fontSize: 10, color: colors.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {card.company}
        </span>
      ) : null}
      <div style={{ display: "flex", alignItems: "center", gap: spacing[2], marginTop: 1 }}>
        <span style={biasPillStyle(card.bias, colors)}>
          {card.bias === "bull" ? "Long" : card.bias === "bear" ? "Short" : "Neutral"}
        </span>
        {card.alignment ? (
          <span style={{ display: "inline-flex", gap: 2 }}>
            {Array.from({ length: card.alignment.total }).map((_, i) => (
              <span
                key={i}
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: "50%",
                  background: i < card.alignment!.aligned ? colors.caution : colors.border
                }}
              />
            ))}
          </span>
        ) : null}
      </div>
      <span style={{ fontSize: 10, color: colors.textMuted, lineHeight: 1.4 }}>{data.note}</span>
      <FeedCardUpdatedLine iso={card.lastEvaluatedAt} colors={colors} />
    </button>
  );
}

function QuietSection({
  title,
  subtitle,
  cards,
  selectedId,
  onSelect,
  colors
}: {
  title: string;
  subtitle: string;
  cards: QuietCardData[];
  selectedId: string | null;
  onSelect: (card: FeedCard) => void;
  colors: Colors;
}) {
  if (cards.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: spacing[2] }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        <span style={{ fontSize: typography.scale.xs, color: colors.textMuted, letterSpacing: "0.1em", textTransform: "uppercase" }}>
          {title}
        </span>
        <span style={{ fontSize: 10, color: colors.textMuted, opacity: 0.85 }}>{subtitle}</span>
      </div>
      {cards.map((c) => (
        <QuietCard key={c.card.id} data={c} active={c.card.id === selectedId} onSelect={onSelect} colors={colors} />
      ))}
    </div>
  );
}

export function QuietFeed({
  swingDesk,
  dayDesk,
  showDay,
  snapshotsBySymbol,
  companyBySymbol,
  selectedId,
  onSelectCard,
  colors
}: {
  swingDesk: DeskTodayData | null | undefined;
  dayDesk: DeskTodayData | null | undefined;
  showDay: boolean;
  snapshotsBySymbol: Map<string, SnapshotPayload>;
  companyBySymbol: Map<string, string>;
  selectedId: string | null;
  onSelectCard: (card: FeedCard) => void;
  colors: Colors;
}) {
  const symbolsToQuote = useMemo(() => {
    const syms = new Set<string>();
    for (const m of swingDesk?.movers_radar ?? []) syms.add(m.symbol.trim().toUpperCase());
    if (showDay) {
      for (const m of dayDesk?.movers_radar ?? []) syms.add(m.symbol.trim().toUpperCase());
    }
    const sessionSymbols = Array.from(syms);
    const structureRows = resolveBuildingStructureRows({
      deskData: swingDesk,
      nearQualification: [],
      sessionActivitySymbols: sessionSymbols
    });
    for (const row of structureRows) syms.add(row.symbol.trim().toUpperCase());
    return Array.from(syms).slice(0, 40);
  }, [swingDesk, dayDesk, showDay]);

  const [feedSnaps, setFeedSnaps] = useState<Map<string, SnapshotPayload>>(new Map());

  useEffect(() => {
    if (symbolsToQuote.length === 0) {
      setFeedSnaps(new Map());
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/stocvest/market/snapshots?symbols=${encodeURIComponent(symbolsToQuote.join(","))}`,
          { cache: "no-store" }
        );
        if (!res.ok || cancelled) return;
        const json = (await res.json().catch(() => ({}))) as { snapshots?: SnapshotPayload[] };
        const rows = Array.isArray(json.snapshots) ? json.snapshots : [];
        if (cancelled) return;
        const next = new Map<string, SnapshotPayload>();
        for (const row of rows) {
          const sym = (row.symbol || "").trim().toUpperCase();
          if (sym) next.set(sym, row);
        }
        setFeedSnaps(next);
      } catch {
        /* quotes are best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [symbolsToQuote.join(",")]);

  const mergedSnapshots = useMemo(() => {
    const map = new Map(snapshotsBySymbol);
    for (const [sym, snap] of feedSnaps) map.set(sym, snap);
    return map;
  }, [snapshotsBySymbol, feedSnaps]);

  const symbolNames = useSymbolNames(symbolsToQuote);

  const companyFor = (sym: string): string | null =>
    mergedSnapshots.get(sym)?.company_name?.trim() ||
    companyBySymbol.get(sym) ||
    symbolNames[sym] ||
    null;
  const priceFor = (sym: string): number | null => {
    const snap = mergedSnapshots.get(sym);
    const p = snap?.last_trade_price ?? snap?.day_close;
    return typeof p === "number" && Number.isFinite(p) ? p : null;
  };

  const sessionActivity = useMemo<QuietCardData[]>(() => {
    const rows: { symbol: string; gap: number; direction: "up" | "down"; rank: number; lane: FeedLane }[] = [];
    for (const m of swingDesk?.movers_radar ?? []) {
      rows.push({ symbol: m.symbol.trim().toUpperCase(), gap: m.gap_percent, direction: m.direction, rank: m.rank_score, lane: "swing" });
    }
    if (showDay) {
      for (const m of dayDesk?.movers_radar ?? []) {
        rows.push({ symbol: m.symbol.trim().toUpperCase(), gap: m.gap_percent, direction: m.direction, rank: m.rank_score, lane: "day" });
      }
    }
    const bySymbol = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      const cur = bySymbol.get(r.symbol);
      if (!cur || Math.abs(r.gap) > Math.abs(cur.gap)) bySymbol.set(r.symbol, r);
    }
    return Array.from(bySymbol.values())
      .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))
      .slice(0, 6)
      .map((r) => ({
        card: {
          id: `${r.lane}:${r.symbol}`,
          symbol: r.symbol,
          company: companyFor(r.symbol),
          lane: r.lane,
          state: "potential",
          bias: biasFromDirection(r.direction),
          verdict: "Session mover — open for the full read.",
          phase: "session activity",
          price: priceFor(r.symbol),
          changePct: r.gap,
          alignment: null,
          rankScore: r.rank,
          source: "desk",
          lastEvaluatedAt:
            (r.lane === "day" ? dayDesk?.generated_at : swingDesk?.generated_at)?.trim() || null
        } satisfies FeedCard,
        note: `Moving ${r.gap >= 0 ? "up" : "down"} ${Math.abs(r.gap).toFixed(1)}% this session`
      }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swingDesk?.movers_radar, dayDesk?.movers_radar, showDay, mergedSnapshots, companyBySymbol, symbolNames]);

  const buildingStructure = useMemo<QuietCardData[]>(() => {
    const sessionSymbols = sessionActivity.map((s) => s.card.symbol);
    const rows = resolveBuildingStructureRows({
      deskData: swingDesk,
      nearQualification: [],
      sessionActivitySymbols: sessionSymbols
    }).slice(0, 6);
    return rows.map((row) => {
      const leader = row.quietLeader;
      const mover = row.lowVelocity;
      const direction = leader?.direction ?? mover?.direction ?? null;
      const ratio = leader?.alignment_ratio ?? null;
      const aligned = alignedLayersFromAlignmentRatio(ratio, LAYER_TOTAL);
      const gap = leader?.gap_percent ?? mover?.gap_percent ?? null;
      const note =
        leader?.why_line?.trim() ||
        leader?.execution_hint?.trim() ||
        (row.source === "near_qualification" ? "Near desk gates" : "Structure forming — not a session mover");
      return {
        card: {
          id: `swing:${row.symbol}`,
          symbol: row.symbol,
          company: companyFor(row.symbol),
          lane: "swing",
          state: row.source === "quiet_leader" || row.source === "near_qualification" ? "near" : "potential",
          bias: biasFromDirection(direction),
          verdict: note,
          phase: "building structure",
          price: priceFor(row.symbol),
          changePct: typeof gap === "number" ? gap : null,
          alignment: aligned != null ? { aligned, total: LAYER_TOTAL } : null,
          rankScore: leader?.rank_score ?? mover?.rank_score ?? 0,
          source: "desk",
          lastEvaluatedAt: swingDesk?.generated_at?.trim() || null
        } satisfies FeedCard,
        note
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swingDesk, sessionActivity, mergedSnapshots, companyBySymbol, symbolNames]);

  if (sessionActivity.length === 0 && buildingStructure.length === 0) {
    return (
      <p style={{ margin: 0, fontSize: typography.scale.sm, color: colors.textMuted, lineHeight: 1.5 }}>
        The desk is quiet — no qualified setups, movers, or building structure right now. This is normal when
        gates are closed or the tape is flat.
      </p>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: spacing[4] }}>
      <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.5 }}>
        No qualified setups right now. Here&apos;s what the desk is watching while conditions develop.
      </p>
      <QuietSection
        title={`Session activity · ${sessionActivity.length}`}
        subtitle="Today's bigger movers"
        cards={sessionActivity}
        selectedId={selectedId}
        onSelect={onSelectCard}
        colors={colors}
      />
      <QuietSection
        title={`Building structure · ${buildingStructure.length}`}
        subtitle="Quiet leaders & names forming structure"
        cards={buildingStructure}
        selectedId={selectedId}
        onSelect={onSelectCard}
        colors={colors}
      />
    </div>
  );
}
