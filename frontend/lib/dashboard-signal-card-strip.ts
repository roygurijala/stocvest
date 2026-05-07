import type { SnapshotPayload } from "@/lib/api/market";
import type { IntradaySetupPayload } from "@/lib/api/scanner";
import type { EarningsEvent } from "@/lib/api/earnings";
import { earningsTimingLabel } from "@/lib/earnings-timing";
import { coerceSnapshotForReferenceLevels } from "@/lib/snapshot-reference-levels";
import { swingStylePatternLine } from "@/lib/scanner-swing-triggers";

function roundPrice(n: number): number {
  return Math.round(n * 100) / 100;
}

function longGeometry(snap: SnapshotPayload): { stop: number | null; target: number | null } {
  const last = typeof snap.last_trade_price === "number" ? snap.last_trade_price : null;
  const dayLo = typeof snap.day_low === "number" ? snap.day_low : null;
  const dayHi = typeof snap.day_high === "number" ? snap.day_high : null;
  const vwap = typeof snap.day_vwap === "number" ? snap.day_vwap : null;
  const prevClose = typeof snap.prev_close === "number" ? snap.prev_close : null;

  let stop: number | null = null;
  if (dayLo != null && dayLo > 0 && vwap != null && vwap > 0) {
    stop = roundPrice(Math.min(dayLo, vwap) * 0.998);
  } else if (dayLo != null && dayLo > 0) {
    stop = roundPrice(dayLo * 0.995);
  } else if (vwap != null && vwap > 0) {
    stop = roundPrice(vwap * 0.995);
  } else if (prevClose != null && prevClose > 0) {
    stop = roundPrice(prevClose * 0.99);
  } else if (last != null && last > 0) {
    stop = roundPrice(last * 0.98);
  }

  let target: number | null = null;
  if (dayHi != null && dayHi > 0) {
    target = roundPrice(dayHi);
  } else if (last != null && last > 0) {
    target = roundPrice(last * 1.012);
  }

  return { stop, target };
}

function shortGeometry(snap: SnapshotPayload): { stop: number | null; target: number | null } {
  const last = typeof snap.last_trade_price === "number" ? snap.last_trade_price : null;
  const dayLo = typeof snap.day_low === "number" ? snap.day_low : null;
  const dayHi = typeof snap.day_high === "number" ? snap.day_high : null;
  const vwap = typeof snap.day_vwap === "number" ? snap.day_vwap : null;
  const prevClose = typeof snap.prev_close === "number" ? snap.prev_close : null;

  let stop: number | null = null;
  if (dayHi != null && dayHi > 0 && vwap != null && vwap > 0) {
    stop = roundPrice(Math.max(dayHi, vwap) * 1.002);
  } else if (dayHi != null && dayHi > 0) {
    stop = roundPrice(dayHi * 1.005);
  } else if (vwap != null && vwap > 0) {
    stop = roundPrice(vwap * 1.005);
  } else if (prevClose != null && prevClose > 0) {
    stop = roundPrice(prevClose * 1.01);
  } else if (last != null && last > 0) {
    stop = roundPrice(last * 1.02);
  }

  let target: number | null = null;
  if (dayLo != null && dayLo > 0) {
    target = roundPrice(dayLo);
  } else if (last != null && last > 0) {
    target = roundPrice(last * 0.988);
  }

  return { stop, target };
}

function rrFromLevels(entry: number, target: number, stop: number, direction: "long" | "short"): number | null {
  if (direction === "long") {
    const risk = entry - stop;
    const reward = target - entry;
    if (risk <= 1e-6 || reward <= 1e-6) return null;
    return reward / risk;
  }
  const risk = stop - entry;
  const reward = entry - target;
  if (risk <= 1e-6 || reward <= 1e-6) return null;
  return reward / risk;
}

function entryZoneFromSnapshot(snap: SnapshotPayload, last: number, direction: "long" | "short"): { lo: number; hi: number } | null {
  const dh = typeof snap.day_high === "number" ? snap.day_high : null;
  const dl = typeof snap.day_low === "number" ? snap.day_low : null;
  if (dh != null && dl != null && dh > dl) {
    const padLo = direction === "long" ? Math.min(dl, last * 0.997) : Math.min(dl, last * 0.998);
    const padHi = direction === "long" ? Math.max(dh, last * 1.003) : Math.max(dh, last * 1.002);
    return { lo: roundPrice(padLo), hi: roundPrice(padHi) };
  }
  if (last > 0) {
    const w = last * 0.012;
    return direction === "long"
      ? { lo: roundPrice(last - w), hi: roundPrice(last + w * 0.6) }
      : { lo: roundPrice(last - w * 0.6), hi: roundPrice(last + w) };
  }
  return null;
}

function formatMd(iso: string): string {
  const d = iso.slice(0, 10);
  if (d.length !== 10) return iso;
  const [y, m, day] = d.split("-");
  return `${m}/${day}`;
}

function catalystFromEarnings(
  symbol: string,
  upcoming: EarningsEvent[],
  recent: EarningsEvent[]
): string {
  const sym = symbol.trim().toUpperCase();
  const rec = recent.find((e) => e.symbol.trim().toUpperCase() === sym);
  if (rec?.actual_eps != null && rec.estimated_eps != null) {
    if (rec.actual_eps > rec.estimated_eps + 1e-6) {
      return `Earnings beat ${formatMd(rec.report_date)}`;
    }
    if (rec.actual_eps < rec.estimated_eps - 1e-6) {
      return `Earnings miss ${formatMd(rec.report_date)}`;
    }
    return `Earnings inline ${formatMd(rec.report_date)}`;
  }
  const up = upcoming.find((e) => e.symbol.trim().toUpperCase() === sym);
  if (up) {
    const tag = earningsTimingLabel(up.report_time);
    return `Earnings ${tag} ${formatMd(up.report_date)}`;
  }
  return "No headline catalyst on calendar";
}

/** Calendar days since ISO timestamp (scanner bar time) — coarse “maturity” hint until swing age exists in API. */
export function setupAgeCalendarDays(timestampIso: string): number | null {
  const t = Date.parse(timestampIso);
  if (!Number.isFinite(t)) return null;
  const days = Math.floor((Date.now() - t) / 86400000);
  return Math.max(0, Math.min(30, days));
}

export type DashboardSignalCardStrip = {
  patternLine: string;
  /** Daily swing scanner: EMA crosses, weekly RSI, volume vs 20D when `scanner_mode === swing_daily`. */
  swingDailyDetailLine: string | null;
  entryZoneLine: string | null;
  stopTargetLine: string | null;
  maturityLine: string | null;
  catalystLine: string;
};

function swingDailyDetailLine(setup: IntradaySetupPayload): string | null {
  if (setup.scanner_mode !== "swing_daily") return null;
  const bits: string[] = [];
  if (setup.ema_daily_crossovers?.length) {
    bits.push(`Daily EMA: ${setup.ema_daily_crossovers.join(", ")}`);
  }
  if (setup.weekly_rsi_recovery === true && typeof setup.weekly_rsi === "number" && Number.isFinite(setup.weekly_rsi)) {
    bits.push(`Weekly RSI recovery (${setup.weekly_rsi.toFixed(0)})`);
  } else if (typeof setup.weekly_rsi === "number" && Number.isFinite(setup.weekly_rsi)) {
    bits.push(`Weekly RSI ${setup.weekly_rsi.toFixed(0)}`);
  }
  if (typeof setup.volume_expansion_ratio === "number" && Number.isFinite(setup.volume_expansion_ratio)) {
    bits.push(`Vol vs 20D avg ×${setup.volume_expansion_ratio.toFixed(2)}`);
  }
  return bits.length > 0 ? bits.join(" · ") : null;
}

export function buildDashboardSignalCardStrip(
  setup: IntradaySetupPayload,
  snapshot: SnapshotPayload | undefined,
  earnings: { upcoming: EarningsEvent[]; recent: EarningsEvent[] }
): DashboardSignalCardStrip {
  const patternLine = swingStylePatternLine(setup.triggers);
  const swingDailyDetail = swingDailyDetailLine(setup);
  const snap = coerceSnapshotForReferenceLevels(snapshot ?? null);
  const last =
    typeof setup.last_price === "number" && Number.isFinite(setup.last_price)
      ? setup.last_price
      : typeof snap?.last_trade_price === "number"
        ? snap.last_trade_price
        : null;

  const dir: "long" | "short" = setup.direction.toLowerCase().includes("short") ? "short" : "long";
  let entryZoneLine: string | null = null;
  let stopTargetLine: string | null = null;

  if (snap && typeof last === "number" && last > 0) {
    const zone = entryZoneFromSnapshot(snap, last, dir);
    if (zone) {
      entryZoneLine = `$${zone.lo.toFixed(0)}–$${zone.hi.toFixed(0)} entry zone`;
    }
    const g = dir === "long" ? longGeometry(snap) : shortGeometry(snap);
    const entry = last;
    if (g.stop != null && g.target != null && entry > 0) {
      const rr = rrFromLevels(entry, g.target, g.stop, dir);
      const rrStr = rr != null ? ` (${rr.toFixed(1)}:1)` : "";
      stopTargetLine = `Stop $${g.stop.toFixed(2)} · Target $${g.target.toFixed(2)}${rrStr}`;
    }
  }

  const age = setupAgeCalendarDays(setup.timestamp_iso);
  let maturityLine: string | null;
  if (setup.scanner_mode === "swing_daily" && typeof setup.pattern_maturity_days === "number") {
    const n = setup.pattern_maturity_days;
    maturityLine = `Pattern maturity: ${n} session${n === 1 ? "" : "s"} with close vs daily EMA20/50 stacked`;
  } else if (age == null) {
    maturityLine = "Maturity: see Evidence for daily trend";
  } else if (age === 0) {
    maturityLine = "Scanner read: same calendar day as last bar";
  } else {
    maturityLine = `Scanner age ~${age} calendar day${age === 1 ? "" : "s"} · confirm swing maturity in Evidence`;
  }

  const catalystLine = catalystFromEarnings(setup.symbol, earnings.upcoming, earnings.recent);

  return { patternLine, swingDailyDetailLine: swingDailyDetail, entryZoneLine, stopTargetLine, maturityLine, catalystLine };
}
