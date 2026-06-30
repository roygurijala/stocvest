/**
 * Entry-zone presentation helpers — keep in sync with stocvest/api/services/entry_zone.py.
 */

export type EntryStyle = "pullback" | "breakout";
export type EntryDistanceTier = "ideal" | "acceptable" | "chasing";
export type EntryQualityTier = "high" | "medium" | "low";
export type EntryValidationQuality = "clean" | "clamped" | "no_clean_entry";

export type IdealPullbackZone = { low: number; high: number };

export function parseEntryDistanceTier(raw: unknown): EntryDistanceTier | null {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "ideal" || s === "acceptable" || s === "chasing") return s;
  return null;
}

export function parseEntryQualityTier(raw: unknown): EntryQualityTier | null {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "high" || s === "medium" || s === "low") return s;
  return null;
}

export function parseEntryStyle(raw: unknown): EntryStyle | null {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "pullback" || s === "breakout") return s;
  return null;
}

export function distanceTierLabel(tier: EntryDistanceTier): string {
  if (tier === "ideal") return "Ideal distance";
  if (tier === "acceptable") return "Acceptable distance";
  return "Chasing";
}

export function entryQualityTierLabel(tier: EntryQualityTier): string {
  if (tier === "high") return "High quality";
  if (tier === "medium") return "Medium quality";
  return "Low quality";
}

export function entryStyleLabel(style: EntryStyle): string {
  return style === "breakout" ? "Breakout entry" : "Pullback entry";
}

export function buildEntryDistanceWarning(input: {
  distanceTier: EntryDistanceTier | null;
  distanceAtr: number | null;
  anchor: number | null;
}): string | null {
  if (input.distanceTier !== "chasing") return null;
  const dist =
    input.distanceAtr != null && Number.isFinite(input.distanceAtr)
      ? `${input.distanceAtr.toFixed(1)}× ATR`
      : "far";
  const anchor =
    input.anchor != null && Number.isFinite(input.anchor)
      ? `$${input.anchor.toFixed(2)} structure`
      : "structure";
  return `Price is ${dist} from ${anchor} — wait for a pullback before entering.`;
}

export function formatIdealPullbackZone(zone: IdealPullbackZone | null | undefined): string | null {
  if (!zone || !Number.isFinite(zone.low) || !Number.isFinite(zone.high) || zone.high <= zone.low) {
    return null;
  }
  return `$${zone.low.toFixed(2)} – $${zone.high.toFixed(2)}`;
}
