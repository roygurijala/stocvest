/**
 * Geometry honesty rows — deep-dive parity with execution-actionable email rows.
 *
 * Stop distance (ATR + %), T1 R/R, optional Plan R/R (T2) when day-mode
 * promotion applies. Downgrades when `stop_too_tight_for_swing`.
 */

import {
  planUsesT2Promotion,
  roundRiskRewardDisplay,
  structureRiskRewardForMode
} from "@/lib/risk-reward-structure";
import { parseTarget2Provenance } from "@/lib/target-provenance";
import { parsePositiveRiskReward } from "@/lib/structure-risk-reward-present";

export const MIN_SWING_STOP_DISTANCE_ATR = 1.5;

export type GeometryHonestyTone = "default" | "muted" | "caution";

export type GeometryHonestyRow = {
  label: string;
  value: string;
  tone: GeometryHonestyTone;
  note?: string;
};

export type GeometryHonestyPresent = {
  rows: GeometryHonestyRow[];
  /** Short banner when geometry fails a swing stop-distance gate. */
  headline: string | null;
  showPanel: boolean;
};

function posNum(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

function entryFromBody(body: Record<string, unknown>, price?: number | null): number | null {
  if (price != null && Number.isFinite(price) && price > 0) return price;
  return posNum(body.last_trade_price) ?? posNum(body.price_at_signal) ?? posNum(body.price);
}

function stopDistanceAtrFromBody(body: Record<string, unknown>, entry: number | null): number | null {
  const served = body.reference_stop_distance_atr;
  if (typeof served === "number" && Number.isFinite(served)) return served;
  const stop = posNum(body.reference_stop_level);
  const atr = posNum(body.atr) ?? posNum(body.atr14);
  if (entry == null || stop == null || atr == null || atr <= 0) return null;
  return Math.round((Math.abs(entry - stop) / atr) * 100) / 100;
}

function stopDistancePctFromBody(body: Record<string, unknown>, entry: number | null): number | null {
  const stop = posNum(body.reference_stop_level);
  if (entry == null || stop == null || entry <= 0) return null;
  return Math.round((Math.abs(entry - stop) / entry) * 10000) / 100;
}

function formatStopDistance(atr: number | null, pct: number | null): string | null {
  if (atr != null && pct != null) return `${atr.toFixed(2)}×ATR (${pct.toFixed(1)}%)`;
  if (atr != null) return `${atr.toFixed(2)}×ATR`;
  if (pct != null) return `${pct.toFixed(1)}%`;
  return null;
}

function formatRrValue(rr: number | null, minRr: number | null): string | null {
  if (rr == null || !Number.isFinite(rr)) return null;
  const label = rr.toFixed(2);
  if (minRr != null && Number.isFinite(minRr) && minRr > 0) {
    return `${label} (min ${minRr.toFixed(2)})`;
  }
  return label;
}

function useLongFromBody(body: Record<string, unknown>): boolean {
  const raw = String(body.signal_summary ?? body.verdict ?? "").trim().toLowerCase();
  if (raw === "bullish" || raw === "bull" || raw === "long") return true;
  if (raw === "bearish" || raw === "bear" || raw === "short") return false;
  return true;
}

function resolveT1Rr(body: Record<string, unknown>, entry: number | null): number | null {
  const served = parsePositiveRiskReward(body.t1_risk_reward);
  if (served != null) return served;
  const stop = posNum(body.reference_stop_level);
  const t1 = posNum(body.reference_target_1);
  if (entry == null || stop == null || t1 == null) return null;
  const useLong = useLongFromBody(body);
  const risk = useLong ? entry - stop : stop - entry;
  const reward = useLong ? t1 - entry : entry - t1;
  if (risk <= 1e-6 || reward <= 1e-6) return null;
  return roundRiskRewardDisplay(reward / risk);
}

function resolvePlanRr(
  body: Record<string, unknown>,
  entry: number | null,
  tradingMode: "swing" | "day"
): number | null {
  const fromStructure = parsePositiveRiskReward(body.structure_risk_reward);
  if (fromStructure != null) return fromStructure;
  const headline = parsePositiveRiskReward(body.risk_reward);
  if (headline != null) return headline;
  const stop = posNum(body.reference_stop_level);
  const t1 = posNum(body.reference_target_1);
  const t2 = posNum(body.reference_target_2);
  const prov = parseTarget2Provenance(body.reference_target_2_provenance);
  if (entry == null || stop == null || t1 == null) return null;
  const raw = structureRiskRewardForMode(entry, t1, stop, t2, prov, {
    tradingMode,
    useLong: useLongFromBody(body)
  });
  return raw != null ? roundRiskRewardDisplay(raw) : null;
}

/** Build email-parity geometry rows for deep-dive Setup. */
export function buildGeometryHonestyPresent(input: {
  body: Record<string, unknown>;
  tradingMode: "swing" | "day";
  price?: number | null;
}): GeometryHonestyPresent {
  const { body, tradingMode, price } = input;
  const entry = entryFromBody(body, price);
  const stopAtr = stopDistanceAtrFromBody(body, entry);
  const stopPct = stopDistancePctFromBody(body, entry);
  const minRr = posNum(body.min_rr_desk);
  const blockReason =
    typeof body.geometry_block_reason === "string" && body.geometry_block_reason.trim()
      ? body.geometry_block_reason.trim()
      : null;
  const stopTooTight = blockReason === "stop_too_tight_for_swing";
  const isSwing = tradingMode === "swing";

  const rows: GeometryHonestyRow[] = [];

  const stopDistance = formatStopDistance(stopAtr, stopPct);
  if (stopDistance) {
    rows.push({
      label: "Stop distance",
      value: stopDistance,
      tone: stopTooTight ? "caution" : "default",
      note: stopTooTight
        ? `Below ${MIN_SWING_STOP_DISTANCE_ATR.toFixed(1)}×ATR swing desk minimum — stop is too tight for a swing hold.`
        : undefined
    });
  }

  const t1Rr = resolveT1Rr(body, entry);
  const planRr = resolvePlanRr(body, entry, tradingMode);

  if (isSwing) {
    const swingRr = planRr ?? t1Rr;
    const swingLabel = formatRrValue(swingRr, minRr);
    if (swingLabel) {
      rows.push({
        label: "T1 risk / reward",
        value: swingLabel,
        tone: stopTooTight || swingRr == null || (minRr != null && swingRr < minRr) ? "caution" : "default",
        note:
          stopTooTight && swingRr != null
            ? "Shown for transparency — desk blocks swing execution until stop widens."
            : swingRr != null && minRr != null && swingRr < minRr
              ? "Sub-desk minimum — not actionable at current structure."
              : undefined
      });
    } else if (stopTooTight) {
      rows.push({
        label: "T1 risk / reward",
        value: "—",
        tone: "muted",
        note: "Geometry insufficient — no validated T1 R/R at current price."
      });
    }
  } else {
    const stop = posNum(body.reference_stop_level);
    const t1 = posNum(body.reference_target_1);
    const t2 = posNum(body.reference_target_2);
    const prov = parseTarget2Provenance(body.reference_target_2_provenance);
    const t2Promotion =
      entry != null &&
      stop != null &&
      t1 != null &&
      planUsesT2Promotion(entry, t1, stop, t2, prov, { useLong: useLongFromBody(body) });

    if (planRr != null) {
      const planLabel = formatRrValue(planRr, minRr);
      if (planLabel) {
        rows.push({
          label: t2Promotion ? "Plan R/R (T2)" : "Plan risk / reward",
          value: planLabel,
          tone: minRr != null && planRr < minRr ? "caution" : "default",
          note: t2Promotion ? "T1 was sub-1:1 — plan uses anchored T2 for desk gate." : undefined
        });
      }
    }

    if (
      t1Rr != null &&
      (planRr == null || Math.abs(t1Rr - planRr) > 0.05)
    ) {
      const t1Label = formatRrValue(t1Rr, minRr);
      if (t1Label) {
        rows.push({
          label: "T1 risk / reward",
          value: t1Label,
          tone: t1Rr < 1 ? "caution" : "default"
        });
      }
    } else if (planRr == null && t1Rr != null) {
      const t1Label = formatRrValue(t1Rr, minRr);
      if (t1Label) {
        rows.push({ label: "T1 risk / reward", value: t1Label, tone: "default" });
      }
    }
  }

  const headline = stopTooTight
    ? "Stop too tight for swing desk"
    : blockReason === "geometry_insufficient" || blockReason === "no_clean_entry"
      ? "Geometry not tradable at current structure"
      : null;

  return {
    rows,
    headline,
    showPanel: rows.length > 0
  };
}
