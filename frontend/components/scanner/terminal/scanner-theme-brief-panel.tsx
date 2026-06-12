"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronLeft } from "lucide-react";
import type { SnapshotPayload } from "@/lib/api/market";
import { borderRadius, spacing, typography, type ThemeColors } from "@/lib/design-system";
import { defaultDeskTracking } from "@/lib/watchlist-symbol-tracking";
import { invalidateWatchlistMembershipCache } from "@/lib/watchlist-membership-client";
import type {
  ScannerTerminalGapRow,
  ScannerTerminalRadarGroup
} from "@/lib/scanner/terminal/scanner-terminal-model";
import { buildThemeSymbolRows } from "@/lib/scanner/terminal/theme-symbol-rows";

type Props = {
  group: ScannerTerminalRadarGroup;
  gaps: ScannerTerminalGapRow[];
  onSelectSymbol: (symbol: string) => void;
  colors: ThemeColors;
};

function fmtPct(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

function fmtPrice(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `$${n.toFixed(2)}`;
}

function nyTodayIso(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function formatIpoDateLabel(ipoDate: string | null | undefined): string | null {
  if (!ipoDate?.trim()) return null;
  const today = nyTodayIso();
  if (ipoDate === today) return "IPO today";
  try {
    const d = new Date(`${ipoDate}T12:00:00`);
    return `IPO ${d.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" })}`;
  } catch {
    return `IPO ${ipoDate}`;
  }
}

function themeContextLines(group: ScannerTerminalRadarGroup): string[] {
  const lines: string[] = [];
  if (group.themeKind === "ipo_ecosystem") {
    const listed = group.listedTicker?.trim().toUpperCase();
    const offer = group.ipoOfferPrice;
    if (listed && offer != null && Number.isFinite(offer)) {
      lines.push(`${listed} offer price ${fmtPrice(offer)} — day-1 gap vs offer when no prior close`);
    } else if (listed) {
      lines.push(`${listed} listing — indications often appear ~9:50 AM ET`);
    }
    const ipoLabel = formatIpoDateLabel(group.ipoDate);
    if (ipoLabel) lines.push(ipoLabel);
    if (group.indexInclusionEnd) {
      lines.push(`Index rebalance window through ${group.indexInclusionEnd}`);
    }
    const listedStake = listed ? group.stakeNotes?.[listed] : null;
    if (listedStake) lines.push(listedStake);
  } else if (group.themeKind === "sector") {
    if (group.sectorEtf) lines.push(`Sector ETF ${group.sectorEtf} — names in today's funnel`);
    if (group.note) lines.push(group.note);
  } else if (group.note) {
    lines.push(group.note);
  }
  return lines.slice(0, 4);
}

function themeWarnings(group: ScannerTerminalRadarGroup, gaps: ScannerTerminalGapRow[]): string[] {
  const warnings: string[] = [];
  const today = nyTodayIso();
  const listed = group.listedTicker?.trim().toUpperCase();
  const isIpoDay = group.themeKind === "ipo_ecosystem" && group.ipoDate === today;

  if (isIpoDay) {
    warnings.push("IPO day — mechanical flows and index rebalance narratives may distort volume.");
    if (listed) {
      warnings.push(`Signal engine blocked on ${listed} (listing day) — ecosystem peers evaluated normally.`);
    }
  }

  const ipoWatch = listed ? gaps.find((g) => g.symbol === listed && g.isIpoWatch) : null;
  if (ipoWatch && !warnings.some((w) => w.includes(listed!))) {
    warnings.push(`IPO watch active on ${listed} — gap uses offer price until a prior close exists.`);
  }

  return warnings;
}

function statusColor(tone: string, colors: ThemeColors): string {
  if (tone === "bull") return colors.bullish;
  if (tone === "bear") return colors.bearish;
  if (tone === "caution") return colors.caution;
  return colors.textMuted;
}

function AddThemeSymbolsButton({
  symbols,
  colors
}: {
  symbols: string[];
  colors: ThemeColors;
}) {
  const [phase, setPhase] = useState<"idle" | "busy" | "done" | "err">("idle");
  const [msg, setMsg] = useState<string | null>(null);

  const onAddAll = useCallback(async () => {
    if (!symbols.length) return;
    setPhase("busy");
    setMsg(null);
    const defaults = defaultDeskTracking(true);
    let added = 0;
    try {
      for (const sym of symbols) {
        const res = await fetch("/api/stocvest/watchlists/default/symbols", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            symbol: sym,
            track_swing: defaults.swing,
            track_day: defaults.day
          })
        });
        if (res.status === 400) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          if (data.error === "symbol_limit") break;
        }
        if (res.ok) added += 1;
      }
      invalidateWatchlistMembershipCache();
      setPhase("done");
      setMsg(added > 0 ? `Added ${added} symbol${added === 1 ? "" : "s"} to watchlist` : "No new symbols added");
    } catch {
      setPhase("err");
      setMsg("Could not update watchlist");
    }
  }, [symbols]);

  return (
    <div style={{ marginTop: spacing[4] }}>
      <button
        type="button"
        onClick={() => void onAddAll()}
        disabled={phase === "busy"}
        style={{
          width: "100%",
          padding: `${spacing[2]} ${spacing[3]}`,
          borderRadius: borderRadius.md,
          border: `1px solid ${colors.border}`,
          background: colors.surfaceMuted ?? colors.surface,
          color: colors.text,
          fontSize: typography.scale.xs,
          fontWeight: 700,
          cursor: phase === "busy" ? "wait" : "pointer"
        }}
      >
        {phase === "busy" ? "Adding…" : "+ Add all to watchlist"}
      </button>
      {msg ? (
        <p style={{ margin: `${spacing[2]} 0 0`, fontSize: typography.scale.xs, color: phase === "err" ? colors.bearish : colors.textMuted }}>
          {msg}
        </p>
      ) : null}
    </div>
  );
}

export function ScannerThemeBriefPanel({ group, gaps, onSelectSymbol, colors }: Props) {
  const [snapshots, setSnapshots] = useState<Map<string, SnapshotPayload>>(new Map());
  const [loading, setLoading] = useState(true);

  const gapBySymbol = useMemo(() => new Map(gaps.map((g) => [g.symbol.toUpperCase(), g])), [gaps]);

  useEffect(() => {
    const symbols = group.symbols.map((s) => s.trim().toUpperCase()).filter(Boolean);
    if (!symbols.length) {
      setSnapshots(new Map());
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const res = await fetch(
          `/api/stocvest/market/snapshots?symbols=${encodeURIComponent(symbols.join(","))}`,
          { cache: "no-store" }
        );
        const body = (await res.json().catch(() => ({}))) as { snapshots?: SnapshotPayload[] };
        const map = new Map<string, SnapshotPayload>();
        for (const row of body.snapshots ?? []) {
          const sym = String(row.symbol ?? "").trim().toUpperCase();
          if (sym) map.set(sym, row);
        }
        if (!cancelled) setSnapshots(map);
      } catch {
        if (!cancelled) setSnapshots(new Map());
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [group.symbols]);

  const rows = useMemo(
    () => buildThemeSymbolRows({ group, snapshots, gapBySymbol }),
    [group, snapshots, gapBySymbol]
  );
  const contextLines = useMemo(() => themeContextLines(group), [group]);
  const warnings = useMemo(() => themeWarnings(group, gaps), [group, gaps]);
  const subtitle = group.targetIpoWindow ?? group.note;

  return (
    <div style={{ padding: spacing[4] }}>
      <p style={{ margin: 0, fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: colors.textMuted }}>
        Theme brief
      </p>
      <h3 style={{ margin: `${spacing[2]} 0 0`, fontSize: typography.scale.lg, color: colors.text }}>{group.title}</h3>
      {subtitle ? (
        <p style={{ margin: `${spacing[1]} 0 0`, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.5 }}>
          {subtitle}
        </p>
      ) : null}

      {contextLines.length > 0 ? (
        <div
          style={{
            marginTop: spacing[3],
            padding: spacing[3],
            borderRadius: borderRadius.md,
            border: `1px solid ${colors.border}`,
            background: colors.surfaceMuted ?? colors.surface
          }}
        >
          <p style={{ margin: 0, fontSize: 9.5, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: colors.textMuted }}>
            Theme context
          </p>
          <ul style={{ margin: `${spacing[2]} 0 0`, paddingLeft: spacing[4], fontSize: typography.scale.xs, color: colors.text, lineHeight: 1.55 }}>
            {contextLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <p style={{ margin: `${spacing[4]} 0 ${spacing[2]}`, fontSize: 9.5, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: colors.textMuted }}>
        Symbols in this theme
      </p>
      <div
        style={{
          borderRadius: borderRadius.md,
          border: `1px solid ${colors.border}`,
          overflow: "hidden"
        }}
      >
        {rows.map((row, idx) => {
          const tone = statusColor(row.statusTone, colors);
          const changeLabel = row.changePct != null ? `${fmtPct(row.changePct)} pre` : loading ? "…" : "";
          return (
            <button
              key={row.symbol}
              type="button"
              onClick={() => onSelectSymbol(row.symbol)}
              style={{
                width: "100%",
                display: "grid",
                gridTemplateColumns: "56px 1fr auto",
                gap: spacing[2],
                alignItems: "center",
                padding: `${spacing[2]} ${spacing[3]}`,
                border: "none",
                borderTop: idx === 0 ? "none" : `1px solid ${colors.border}`,
                background: colors.surface,
                cursor: "pointer",
                textAlign: "left"
              }}
            >
              <span style={{ fontSize: typography.scale.sm, fontWeight: 700, color: colors.text }}>{row.symbol}</span>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontSize: typography.scale.xs, color: colors.textMuted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {row.roleLabel}
                  {row.companyHint ? ` · ${row.companyHint}` : ""}
                </span>
                {row.stakeHint ? (
                  <span style={{ display: "block", fontSize: 10, color: colors.textMuted, marginTop: 2, lineHeight: 1.35 }}>
                    {row.stakeHint}
                  </span>
                ) : null}
              </span>
              <span style={{ textAlign: "right", fontSize: typography.scale.xs, fontVariantNumeric: "tabular-nums" }}>
                {changeLabel ? <span style={{ color: row.changePct != null && row.changePct >= 0 ? colors.bullish : colors.bearish }}>{changeLabel}</span> : null}
                <span style={{ display: "block", marginTop: 2, fontWeight: 700, color: tone }}>{row.statusLabel}</span>
              </span>
            </button>
          );
        })}
      </div>

      <p style={{ margin: `${spacing[2]} 0 0`, fontSize: 10, color: colors.textMuted }}>
        Tap any symbol to see signal detail
      </p>

      {warnings.length > 0 ? (
        <div
          style={{
            marginTop: spacing[3],
            padding: spacing[3],
            borderRadius: borderRadius.md,
            border: `1px solid ${colors.caution}55`,
            background: `${colors.caution}12`
          }}
        >
          {warnings.map((w) => (
            <p key={w} style={{ margin: 0, display: "flex", gap: spacing[2], fontSize: typography.scale.xs, color: colors.text, lineHeight: 1.5 }}>
              <AlertTriangle size={14} style={{ flexShrink: 0, color: colors.caution, marginTop: 2 }} aria-hidden />
              <span>{w}</span>
            </p>
          ))}
        </div>
      ) : null}

      <AddThemeSymbolsButton symbols={group.symbols} colors={colors} />
    </div>
  );
}

export function ThemeSymbolBackBar({
  themeTitle,
  onBack,
  colors
}: {
  themeTitle: string;
  onBack: () => void;
  colors: ThemeColors;
}) {
  return (
    <button
      type="button"
      onClick={onBack}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: spacing[1],
        marginBottom: spacing[2],
        padding: 0,
        border: "none",
        background: "transparent",
        color: colors.accent,
        fontSize: typography.scale.xs,
        fontWeight: 600,
        cursor: "pointer"
      }}
    >
      <ChevronLeft size={16} aria-hidden />
      {themeTitle}
    </button>
  );
}
