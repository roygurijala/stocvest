import type { SnapshotPayload } from "@/lib/api/market";
import { applyRegimeSanityGuard, mapMacroRegimeToLabel, resolveRegimeLabel } from "@/lib/market-context/regime";

/** Breadth read from how many of the tracked indices are advancing. */
export function breadthWord(spyPct: number | null, qqqPct: number | null, iwmPct: number | null): string {
  const vals = [spyPct, qqqPct, iwmPct].filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (vals.length === 0) return "mixed";
  const up = vals.filter((v) => v > 0.05).length;
  const down = vals.filter((v) => v < -0.05).length;
  if (up > down) return "positive";
  if (down > up) return "negative";
  return "mixed";
}

/** VIX in plain English. */
export function vixWord(level: number | null): string {
  if (level == null) return "—";
  if (level < 14) return "calm";
  if (level >= 20) return "elevated";
  return "moderate";
}

/** Concise session word for the pulse line. */
export function sessionWord(marketOpen: boolean | null, marketStatusLabel: string): string {
  if (marketOpen === true) return "Active session";
  if (/extended/i.test(marketStatusLabel)) return "Extended hours";
  if (marketOpen === false) return "Market closed";
  return "Session pending";
}

/** "Market data as of" clock, in US Eastern. */
export function asOfTimeET(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      timeZone: "America/New_York",
      timeZoneName: "short"
    });
  } catch {
    return d.toLocaleTimeString();
  }
}

export function marketStatusLabelFor(market: string | undefined, open: boolean | null): string {
  const m = (market || "").trim().toLowerCase();
  if (m === "open" || open === true) return "Market open";
  if (m === "extended-hours" || m === "extended_hours") return "Extended hours";
  if (m === "closed" || open === false) return "Market closed";
  return "Market status unknown";
}

export function snapPct(s: SnapshotPayload | undefined): number | null {
  if (!s) return null;
  const c = s.change_percent;
  if (typeof c === "number" && Number.isFinite(c) && c > -99.5) return c;
  const last = s.last_trade_price;
  const prev = s.prev_close;
  if (
    typeof last === "number" &&
    typeof prev === "number" &&
    Number.isFinite(last) &&
    Number.isFinite(prev) &&
    prev !== 0
  ) {
    return ((last - prev) / prev) * 100;
  }
  return null;
}

export function resolveSessionRegimeLabel(args: {
  macroRegime?: string | null;
  scannerError?: string | null;
  scannerRegimeLabel?: string | null;
  spyPct: number | null;
  qqqPct: number | null;
}): string {
  const macroRegimeLabel = mapMacroRegimeToLabel(args.macroRegime);
  return applyRegimeSanityGuard(
    macroRegimeLabel ??
      resolveRegimeLabel({
        scannerError: args.scannerError,
        scannerRegimeLabel: args.scannerRegimeLabel,
        spyPct: typeof args.spyPct === "number" ? args.spyPct : null,
        qqqPct: typeof args.qqqPct === "number" ? args.qqqPct : null
      }).label,
    typeof args.spyPct === "number" ? args.spyPct : null,
    typeof args.qqqPct === "number" ? args.qqqPct : null
  );
}
