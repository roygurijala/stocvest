/**
 * Signals command bar — last price + session change (context only, not a live quote).
 */

import type { SnapshotPayload } from "@/lib/api/market";
import {
  formatSignalPrice,
  formatSignalPriceDeltaPct
} from "@/lib/signal-evidence/signal-price-display";
import { effectiveSnapshotPrice } from "@/lib/snapshot-reference-levels";

export type SignalsDeskPriceDayTone = "up" | "down" | "flat";

export type SignalsDeskPriceContext = {
  priceLabel: "Last" | "After hours" | "Pre-market" | "As of close" | "Prior close";
  priceFormatted: string;
  /** Raw numeric display price — used to mark the live level on the price chart. */
  priceValue: number;
  dayChangePct: number | null;
  dayChangeFormatted: string | null;
  dayChangeTone: SignalsDeskPriceDayTone | null;
  accessibleLabel: string;
};

function positivePrice(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return null;
  return raw;
}

function sessionChangePct(snapshot: SnapshotPayload, displayPrice: number): number | null {
  const pick = (v: unknown): number | null => {
    if (typeof v !== "number" || !Number.isFinite(v) || v <= -99.5) return null;
    return v;
  };
  const direct = pick(snapshot.change_percent);
  if (direct != null) return direct;
  const pre = pick(snapshot.pre_market_change_percent);
  if (pre != null) return pre;
  const ah = pick(snapshot.after_hours_change_percent);
  if (ah != null) return ah;
  const prev = positivePrice(snapshot.prev_close);
  if (prev != null) {
    return pick(((displayPrice - prev) / prev) * 100);
  }
  return null;
}

function resolveDisplayPrice(snapshot: SnapshotPayload): { price: number; label: SignalsDeskPriceContext["priceLabel"] } | null {
  const last = positivePrice(snapshot.last_trade_price);
  if (last != null) {
    return { price: last, label: "Last" };
  }
  const afterHours = positivePrice(snapshot.after_hours_price);
  if (afterHours != null) {
    return { price: afterHours, label: "After hours" };
  }
  const preMarket = positivePrice(snapshot.pre_market_price);
  if (preMarket != null) {
    return { price: preMarket, label: "Pre-market" };
  }
  const close = positivePrice(snapshot.day_close);
  if (close != null) {
    return { price: close, label: "As of close" };
  }
  const prior = positivePrice(snapshot.prev_close);
  if (prior != null) {
    return { price: prior, label: "Prior close" };
  }
  return null;
}

/** True when the command bar can show an inline price for this snapshot. */
export function snapshotHasDeskDisplayPrice(snapshot: SnapshotPayload | null | undefined): boolean {
  return effectiveSnapshotPrice(snapshot) != null;
}

function dayChangeTone(pct: number): SignalsDeskPriceDayTone {
  if (pct > 0.05) return "up";
  if (pct < -0.05) return "down";
  return "flat";
}

/** Build inline price context for the Signals command bar. */
export function buildSignalsDeskPriceContext(
  snapshot: SnapshotPayload | null | undefined
): SignalsDeskPriceContext | null {
  if (!snapshot) return null;
  const display = resolveDisplayPrice(snapshot);
  if (!display) return null;

  const dayChangePct = sessionChangePct(snapshot, display.price);
  const dayChangeFormatted = dayChangePct != null ? formatSignalPriceDeltaPct(dayChangePct) : null;
  const tone = dayChangePct != null ? dayChangeTone(dayChangePct) : null;

  const parts = [`${display.label} ${formatSignalPrice(display.price)}`];
  if (dayChangeFormatted) parts.push(`${dayChangeFormatted} today`);
  const accessibleLabel = `${parts.join(", ")}. Context only — not a live trading quote.`;

  return {
    priceLabel: display.label,
    priceFormatted: formatSignalPrice(display.price),
    priceValue: display.price,
    dayChangePct,
    dayChangeFormatted,
    dayChangeTone: tone,
    accessibleLabel
  };
}
