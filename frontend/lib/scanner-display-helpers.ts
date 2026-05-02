import type { SnapshotPayload } from "@/lib/api/market";
import type { GapCandidatePayload } from "@/lib/api/scanner";
import { coerceSnapshotForReferenceLevels } from "@/lib/snapshot-reference-levels";
import { barIsPremarketEt, isoDateInNewYork } from "@/lib/market-hours-et";
import type { MinuteBarPayload } from "@/lib/fetch-symbol-bars";

export function formatVolumeShort(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return `${Math.round(n)}`;
}

export function entryZoneFromSnapshot(snapshot: SnapshotPayload | null | undefined): { lo: number; hi: number } | null {
  const c = coerceSnapshotForReferenceLevels(snapshot ?? null);
  if (!c) return null;
  const last = c.last_trade_price;
  const lo = c.day_low ?? (typeof last === "number" ? last * 0.985 : null);
  const hi = c.day_high ?? (typeof last === "number" ? last * 1.015 : null);
  if (typeof lo === "number" && typeof hi === "number" && lo <= hi && Number.isFinite(lo) && Number.isFinite(hi)) {
    return { lo, hi };
  }
  return null;
}

export function gapDirectionContext(gap: GapCandidatePayload, snapshot: SnapshotPayload | null | undefined): string | null {
  const snap = coerceSnapshotForReferenceLevels(snapshot ?? null);
  if (!snap) return null;
  const last = snap.last_trade_price;
  const g = gap.gap_percent;
  if (typeof last !== "number" || !Number.isFinite(last)) return null;
  const support = snap.day_low ?? last * 0.985;
  const resistance = snap.day_high ?? last * 1.015;
  if (g > 0 && typeof resistance === "number" && last > resistance) {
    return "Gap above resistance";
  }
  if (g < 0 && typeof support === "number" && last < support) {
    return "Gap into prior support";
  }
  return null;
}

export function computePmhFromBars(bars: MinuteBarPayload[], nyTradingDate: string): number | null {
  let max: number | null = null;
  for (const b of bars) {
    if (isoDateInNewYork(new Date(b.timestamp)) !== nyTradingDate) continue;
    if (!barIsPremarketEt(b.timestamp)) continue;
    if (!Number.isFinite(b.high)) continue;
    max = max == null ? b.high : Math.max(max, b.high);
  }
  return max;
}

export function setupPatternLabel(triggers: string[] | undefined): string {
  const raw = (triggers?.[0] ?? "intraday_pattern").trim();
  return raw.replace(/_/g, " ");
}

export function setupExpiryNote(patternRaw: string): string {
  const p = patternRaw.trim().toLowerCase();
  if (p.startsWith("orb_")) return "ORB window closes 10:00 AM ET";
  if (p.startsWith("vwap_")) return "Valid while above VWAP";
  if (p.startsWith("ema_")) return "Valid while above 9 EMA";
  return "Intraday pattern — confirm with live price action";
}

export function catalystSentimentBadge(score01: number): { label: "Bullish" | "Bearish" | "Mixed"; tone: "bull" | "bear" | "mixed" } {
  if (score01 > 0.65) return { label: "Bullish", tone: "bull" };
  if (score01 < 0.45) return { label: "Bearish", tone: "bear" };
  return { label: "Mixed", tone: "mixed" };
}
