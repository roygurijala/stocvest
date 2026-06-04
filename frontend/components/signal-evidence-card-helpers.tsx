"use client";

/**
 * Presentation helpers + standalone panels for SignalEvidenceCard.
 * Split out of signal-evidence-card.tsx (which imports them back). All pure
 * functions / props-only components — no behavior change.
 */
import type { CSSProperties } from "react";
import type { LucideIcon } from "lucide-react";
import { AlignJustify, ArrowDown, ArrowUp, Clock } from "lucide-react";
import type { CardTone, ThemeColors } from "@/lib/design-system";
import { borderRadius, cardSurfaceStyle, spacing, typography } from "@/lib/design-system";
import {
  layerFreshnessFromIso,
  structuralBandFromBaselineScore,
  type EvidenceLayer,
  type EvidenceStatus,
  type GeopoliticalLayerExtras,
  type SectorDailySessionWire,
  type SectorResolutionStateWire,
  type SignalEvidenceData,
  type SignalEvidenceInsight
} from "@/lib/signal-evidence";
import type { SignalPriceDriftTier } from "@/lib/signal-evidence/signal-price-display";
import type { LayerEmphasisTier } from "@/lib/signal-evidence/layer-emphasis";

function statusColor(status: EvidenceStatus, colors: ThemeColors): string {
  if (status === "Bullish") return colors.bullish;
  if (status === "Bearish") return colors.bearish;
  if (status === "Neutral") return colors.caution;
  if (status === "As of close") return colors.text;
  return colors.textMuted;
}

function toneFromStatus(status: EvidenceStatus): CardTone {
  if (status === "Bullish") return "bullish";
  if (status === "Bearish") return "bearish";
  if (status === "Neutral") return "caution";
  return "neutral";
}

/**
 * Local alias for the canonical card shell. Kept as a one-liner so existing
 * call sites in this file (`...elevatedCardStyle(colors, tone)`) stay
 * unchanged while the underlying shape lives in design-system.ts as
 * {@link cardSurfaceStyle} — the single source of truth for the app-wide
 * card visual contract.
 */
function elevatedCardStyle(colors: ThemeColors, tone: CardTone = "neutral"): CSSProperties {
  return cardSurfaceStyle(colors, tone);
}

/**
 * Tier-based visual overrides for layer-card rendering (B35,
 * 2026-05-13). Maps the pure `LayerEmphasisTier` value returned by
 * `lib/signal-evidence/layer-emphasis::layerEmphasisTier` into the
 * actual padding / font / opacity values the article uses. Keeps the
 * tier→style mapping in one place so the cards stay consistent across
 * desktop and mobile.
 *
 *   - `primary`   — slightly larger padding, default font size, full
 *                   opacity. Visually dominant in the breakdown grid.
 *   - `secondary` — current default render (no override). Used for
 *                   News, Macro, Internals when they have content.
 *   - `tertiary`  — compact padding, smaller font, slight opacity
 *                   reduction. Used for Sector / Geopolitical when
 *                   they have no active content; promotes back to
 *                   secondary the moment either lights up. We
 *                   deliberately do NOT drop opacity below 0.78 so the
 *                   chip text remains legible on the dark surface.
 */
/**
 * Map the Signal Price drift tier to the platform's color tokens.
 *
 *   - `none` / `marginal` — `textMuted`: drift is below noise floor,
 *     the row is informational rather than load-bearing.
 *   - `moderate`           — `text`: drift is real but the reference
 *     levels still apply; render with the default body color.
 *   - `elevated`           — `caution` (amber): drift is enough to
 *     question the reference geometry — the user should know.
 *   - `stale`              — `bearish` (red): drift has materially
 *     invalidated the reference levels for planning purposes.
 *
 * Direction-agnostic on purpose: we band on |Δ|, not sign. A short
 * setup with the price up 5% is just as stale as a long setup with
 * the price up 5% — both invalidate the reference geometry.
 */
function signalPriceDriftColor(tier: SignalPriceDriftTier, colors: ThemeColors): string {
  if (tier === "stale") return colors.bearish;
  if (tier === "elevated") return colors.caution;
  if (tier === "moderate") return colors.text;
  return colors.textMuted;
}

function tierVisualOverrides(tier: LayerEmphasisTier): {
  padding: string;
  fontScale: "base" | "sm" | "xs";
  opacity: number;
  headerWeight: 600 | 700;
} {
  if (tier === "primary") {
    return { padding: spacing[4], fontScale: "base", opacity: 1, headerWeight: 700 };
  }
  if (tier === "tertiary") {
    return { padding: spacing[2], fontScale: "xs", opacity: 0.82, headerWeight: 600 };
  }
  return { padding: spacing[3], fontScale: "sm", opacity: 1, headerWeight: 600 };
}

function formatLevel(n: number | null | undefined): string {
  return typeof n === "number" ? `$${n.toFixed(2)}` : "—";
}

const MAX_UPDATED_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function displayUpdatedLabel(evidence: SignalEvidenceData): string {
  const raw = evidence.updatedAtIso;
  if (raw == null || String(raw).trim() === "") {
    return "Just now";
  }
  const ms = Date.parse(String(raw));
  if (!Number.isFinite(ms)) {
    return "Just now";
  }
  const ageMs = Date.now() - ms;
  if (ageMs < 0 || ageMs > MAX_UPDATED_AGE_MS) {
    return "Just now";
  }
  return evidence.updatedLabel;
}

const MAX_REASONABLE_HOURS = 24 * 30;

function displayLayerFreshness(layer: EvidenceLayer, evidence: SignalEvidenceData): string {
  if (layer.key === "technical") {
    return layerFreshnessFromIso(evidence.updatedAtIso);
  }
  const m = /^Updated (\d+)h ago$/.exec(layer.freshnessLabel);
  if (m) {
    const hours = Number(m[1]);
    if (Number.isFinite(hours) && hours > MAX_REASONABLE_HOURS) {
      return "Just now";
    }
  }
  return layer.freshnessLabel;
}

function sectorResolutionLabel(state: SectorResolutionStateWire | null | undefined): string {
  if (!state) return "";
  if (state === "resolved") return "Resolved";
  if (state === "pending_cache_refresh") return "Unavailable (not factored)";
  return "Unmapped";
}

function sectorBenchmarkLabel(layer: EvidenceLayer): string | null {
  const etf = layer.sector_etf?.trim();
  const name = layer.sector_display_name?.trim();
  if (name && etf) return `${name} (${etf})`;
  if (etf) return etf;
  if (name) return name;
  return null;
}

function sectorLayerHasMomentumDetails(layer: EvidenceLayer): boolean {
  if (layer.key !== "sector") return false;
  return (
    sectorBenchmarkLabel(layer) != null ||
    layer.sector_resolution_state != null ||
    layer.sector_interpretation != null ||
    layer.sector_data_available != null ||
    layer.sector_persistence != null ||
    layer.sector_sessions_leading != null ||
    (layer.sector_daily_sessions != null && layer.sector_daily_sessions.length > 0)
  );
}

function SectorMomentumPanel({ layer, colors }: { layer: EvidenceLayer; colors: ThemeColors }) {
  const st = layer.sector_resolution_state;
  const benchmark = sectorBenchmarkLabel(layer);
  const interp = layer.sector_interpretation?.trim();
  const lead =
    typeof layer.sector_sessions_leading === "number" && typeof layer.sector_total_sessions === "number"
      ? `${layer.sector_sessions_leading}/${layer.sector_total_sessions}`
      : null;
  const pers =
    typeof layer.sector_persistence === "number" && Number.isFinite(layer.sector_persistence)
      ? `${Math.round(layer.sector_persistence * 100)}%`
      : null;
  const rank1 =
    typeof layer.sector_rank_1d === "number" && Number.isFinite(layer.sector_rank_1d)
      ? `1d rank ${(layer.sector_rank_1d * 100).toFixed(0)}%`
      : null;
  const rank5 =
    typeof layer.sector_rank_5d === "number" && Number.isFinite(layer.sector_rank_5d)
      ? `5d rank ${(layer.sector_rank_5d * 100).toFixed(0)}%`
      : null;
  const sessions = layer.sector_daily_sessions ?? [];

  return (
    <div
      className="mt-2 space-y-2 rounded-md px-3 py-2"
      style={{ border: `1px solid ${colors.border}`, background: "rgba(148,163,184,0.06)" }}
    >
      <div className="flex flex-wrap items-center gap-2">
        {benchmark ? (
          <span className="text-xs font-semibold" style={{ color: colors.text }}>
            Benchmark: {benchmark}
          </span>
        ) : null}
        {st ? (
          <span
            className="rounded-full px-2 py-0.5 text-xs font-semibold"
            style={{
              border: `1px solid ${st === "resolved" ? "rgba(34,197,94,0.45)" : "rgba(148,163,184,0.45)"}`,
              background: st === "resolved" ? "rgba(34,197,94,0.1)" : "rgba(148,163,184,0.1)",
              color: st === "resolved" ? colors.bullish : colors.textMuted
            }}
          >
            {sectorResolutionLabel(st)}
          </span>
        ) : null}
        {layer.sector_data_available === false && st === "pending_cache_refresh" ? (
          <span className="text-xs text-muted-foreground">
            Excluded from composite score and alignment until cache is ready — not a system error.
          </span>
        ) : layer.sector_data_available === false && benchmark ? (
          <span className="text-xs text-muted-foreground">
            Sector mapped; session momentum cache is still loading (relative strength vs SPY may update on refresh).
          </span>
        ) : layer.sector_data_available === false ? (
          <span className="text-xs text-muted-foreground">Sector momentum data not available for this read.</span>
        ) : null}
        {layer.sector_trending ? (
          <span className="text-xs text-muted-foreground capitalize">Trend: {layer.sector_trending}</span>
        ) : null}
      </div>
      {lead != null || pers != null ? (
        <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted }}>
          {lead != null ? (
            <>
              <strong style={{ color: colors.text }}>{lead}</strong> sessions vs SPY
            </>
          ) : null}
          {lead != null && pers != null ? " · " : null}
          {pers != null ? (
            <>
              persistence <strong style={{ color: colors.text }}>{pers}</strong>
            </>
          ) : null}
        </p>
      ) : null}
      {(rank1 || rank5) && (
        <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted }}>
          {[rank1, rank5].filter(Boolean).join(" · ")}
        </p>
      )}
      {interp ? (
        <span
          className="inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-semibold"
          style={{
            border: `1px solid rgba(59,130,246,0.42)`,
            background: "rgba(59,130,246,0.1)",
            color: colors.accent
          }}
        >
          {interp}
        </span>
      ) : null}
      {sessions.length > 0 ? (
        <div className="space-y-1">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Recent vs SPY (cached)</div>
          <ul className="m-0 grid list-none gap-1 p-0" style={{ fontSize: typography.scale.xs }}>
            {sessions.slice(-5).map((s: SectorDailySessionWire) => (
              <li key={s.date} className="flex justify-between gap-2 tabular-nums text-muted-foreground">
                <span>{s.date}</span>
                <span style={{ color: s.outperformed ? colors.bullish : colors.textMuted }}>
                  {s.relative >= 0 ? "+" : ""}
                  {s.relative.toFixed(2)}%
                  {s.outperformed ? " · outperform" : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** VWAP chips from the technical layer — always non-empty server copy. */
function technicalVwapChipPresentation(
  point: string,
  colors: ThemeColors
): { skip: boolean; chipStyle: CSSProperties; Icon?: LucideIcon } {
  const lower = point.toLowerCase();
  if (lower.includes("vwap") && lower.includes("— above")) {
    return {
      skip: false,
      chipStyle: {
        fontSize: typography.scale.xs,
        fontWeight: 600,
        border: "1px solid rgba(34,197,94,0.45)",
        background: "rgba(34,197,94,0.12)",
        color: colors.bullish
      },
      Icon: ArrowUp
    };
  }
  if (lower.includes("vwap") && lower.includes("— below")) {
    return {
      skip: false,
      chipStyle: {
        fontSize: typography.scale.xs,
        fontWeight: 600,
        border: "1px solid rgba(239,68,68,0.45)",
        background: "rgba(239,68,68,0.12)",
        color: colors.bearish
      },
      Icon: ArrowDown
    };
  }
  if (point === "VWAP Forming" || lower === "vwap forming") {
    return {
      skip: false,
      chipStyle: {
        fontSize: typography.scale.xs,
        fontWeight: 600,
        border: "1px solid rgba(245,158,11,0.45)",
        background: "rgba(245,158,11,0.14)",
        color: colors.caution
      },
      Icon: Clock
    };
  }
  if (point.startsWith("VWAP starts at") || point.startsWith("VWAP (RTH closed)")) {
    return {
      skip: false,
      chipStyle: {
        fontSize: typography.scale.xs,
        fontWeight: 600,
        border: `1px solid ${colors.border}`,
        background: "rgba(148,163,184,0.10)",
        color: colors.textMuted
      }
    };
  }
  return { skip: true, chipStyle: {} };
}

/** Distinct styling for session ORB chips on the technical layer (evidence modal). */
function technicalOrbChipPresentation(
  point: string,
  colors: ThemeColors
): { skip: boolean; chipStyle: CSSProperties; Icon?: LucideIcon } {
  const lower = point.toLowerCase();
  if (lower.includes("expired")) {
    return { skip: true, chipStyle: {} };
  }
  const baseFont = { fontSize: typography.scale.xs, fontWeight: 600 as const };
  if (point.startsWith("ORB Long")) {
    return {
      skip: false,
      chipStyle: {
        ...baseFont,
        border: "1px solid rgba(34,197,94,0.45)",
        background: "rgba(34,197,94,0.12)",
        color: colors.bullish
      },
      Icon: ArrowUp
    };
  }
  if (point.startsWith("ORB Short")) {
    return {
      skip: false,
      chipStyle: {
        ...baseFont,
        border: "1px solid rgba(239,68,68,0.45)",
        background: "rgba(239,68,68,0.12)",
        color: colors.bearish
      },
      Icon: ArrowDown
    };
  }
  if (point === "ORB Forming") {
    return {
      skip: false,
      chipStyle: {
        ...baseFont,
        border: "1px solid rgba(245,158,11,0.45)",
        background: "rgba(245,158,11,0.14)",
        color: colors.caution
      },
      Icon: Clock
    };
  }
  if (point.startsWith("Inside ORB")) {
    return {
      skip: false,
      chipStyle: {
        ...baseFont,
        border: "1px solid rgba(148,163,184,0.4)",
        background: "rgba(148,163,184,0.12)",
        color: colors.textMuted
      },
      Icon: AlignJustify
    };
  }
  return {
    skip: false,
    chipStyle: {
      fontSize: typography.scale.xs,
      border: `1px solid ${colors.border}`,
      color: colors.textMuted
    }
  };
}

function confluenceChips(evidence: SignalEvidenceData, insight: SignalEvidenceInsight) {
  const yes =
    evidence.confluence?.confirming_signals?.length ? evidence.confluence.confirming_signals : insight.confirming_signals;
  const no =
    evidence.confluence?.conflicting_signals?.length ? evidence.confluence.conflicting_signals : insight.conflicting_signals;
  return { yes, no };
}

const CATALYST_TITLE_MAX = 80;

function truncateCatalystTitle(text: string): string {
  const t = text.trim();
  if (t.length <= CATALYST_TITLE_MAX) return t;
  return `${t.slice(0, CATALYST_TITLE_MAX).trimEnd()}…`;
}

function formatCatalystSource(source: string | undefined): string {
  const s = source?.trim();
  if (!s) return "News";
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function formatGeoEventTypeLabel(et: string): string {
  return et.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Avoid chip/semiconductor-heavy theme copy when the mapped sector is not tech-adjacent. */
function scrubGeoCopyForDisplay(body: string, sectorLabel: string): string {
  const t = body.trim();
  if (!t) return body;
  const s = sectorLabel.trim();
  const techish =
    /semi|software|chip|cloud|saas|hardware|internet|tech|communication|network|digital/i.test(s);
  if (techish) return body;
  if (/semiconductor|chip ban|export controls?|foundry|wafer/i.test(t)) {
    return "No elevated geopolitical sensitivity detected for this company.";
  }
  return body;
}

function geoExposureBandStyles(
  band: "low" | "moderate" | "high" | null,
  colors: ThemeColors
): { bg: string; fg: string; border: string } {
  if (band === "high") return { bg: "rgba(239,68,68,0.10)", fg: colors.bearish, border: "rgba(239,68,68,0.38)" };
  if (band === "moderate") return { bg: "rgba(245,158,11,0.12)", fg: colors.caution, border: "rgba(245,158,11,0.42)" };
  if (band === "low") return { bg: "rgba(34,197,94,0.09)", fg: colors.bullish, border: "rgba(34,197,94,0.38)" };
  return { bg: "rgba(148,163,184,0.10)", fg: colors.textMuted, border: colors.border };
}

function formatSectorMultiplier(m: number | null): string {
  if (m == null || !Number.isFinite(m)) return "—";
  const rounded = Math.round(m * 100) / 100;
  const s = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/\.?0+$/, "");
  return `${s}×`;
}

function GeoStructuralBaselinePanel({ geo, colors }: { geo: GeopoliticalLayerExtras; colors: ThemeColors }) {
  const band = structuralBandFromBaselineScore(geo.geoBaselineScore ?? null) ?? geo.exposureBand;
  const rawBody = (geo.geoBaselineSummary ?? geo.exposureSummary ?? "").trim();
  const body = scrubGeoCopyForDisplay(rawBody, geo.impactSectorLabel ?? "");
  const sector = geo.impactSectorLabel;
  const themeChip =
    geo.geoPrimaryTheme && geo.geoPrimaryTheme.length ? geo.geoPrimaryTheme.replace(/_/g, " ") : "";
  const baselineBadge =
    band === "high" ? "Background sensitivity" : band === "moderate" ? "Structural context" : "Baseline exposure";

  return (
    <div
      style={{
        marginTop: spacing[2],
        padding: spacing[3],
        borderRadius: borderRadius.md,
        border: "1px solid rgba(148,163,184,0.3)",
        background: "linear-gradient(180deg, rgba(51,65,85,0.18), rgba(15,23,42,0.14))",
        boxShadow: "0 0 0 1px rgba(148,163,184,0.08), 0 0 18px rgba(15,23,42,0.24)",
        display: "grid",
        gap: spacing[2]
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span
          style={{
            fontSize: typography.scale.xs,
            fontWeight: 700,
            letterSpacing: "0.055em",
            color: colors.textMuted
          }}
        >
          Structural exposure
        </span>
        {band ? (
          <span
            style={{
              fontSize: typography.scale.xs,
              fontWeight: 600,
              color: colors.textMuted,
              padding: "3px 10px",
              borderRadius: borderRadius.full,
              border: "1px solid rgba(148,163,184,0.3)",
              background: "rgba(148,163,184,0.12)"
            }}
          >
            {baselineBadge}
          </span>
        ) : null}
      </div>
      {themeChip ? (
        <span
          className="w-fit rounded-full px-3 py-1 text-xs font-semibold"
          style={{ border: `1px solid ${colors.border}`, color: colors.text }}
        >
          {sector && sector !== "Sector unknown" ? `${sector} · ${themeChip}` : themeChip}
        </span>
      ) : null}
      {body ? (
        <p style={{ margin: 0, fontSize: typography.scale.sm, color: colors.text, lineHeight: 1.55 }}>
          {body}
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground" style={{ margin: 0 }}>
        Background sensitivity, not an active event.
      </p>
      <p className="text-xs text-muted-foreground" style={{ margin: 0 }}>
        Structural baseline — no active geo escalation in the current window.
      </p>
      <p className="text-xs text-muted-foreground" style={{ margin: 0 }}>
        Structural exposure informs position sizing and confidence — not entry timing.
      </p>
    </div>
  );
}

function GeopoliticalExposurePanel({ geo, colors }: { geo: GeopoliticalLayerExtras; colors: ThemeColors }) {
  const bandSt = geoExposureBandStyles(geo.exposureBand, colors);
  return (
    <div
      style={{
        marginTop: spacing[2],
        padding: spacing[3],
        borderRadius: borderRadius.md,
        border: `1px solid ${bandSt.border}`,
        background: bandSt.bg,
        display: "grid",
        gap: spacing[2]
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span
          style={{
            fontSize: typography.scale.xs,
            fontWeight: 700,
            letterSpacing: "0.055em",
            color: colors.textMuted
          }}
        >
          Stock geo exposure
        </span>
        {geo.exposureBand ? (
          <span
            style={{
              fontSize: typography.scale.xs,
              fontWeight: 700,
              textTransform: "capitalize",
              color: bandSt.fg,
              padding: "3px 10px",
              borderRadius: borderRadius.full,
              border: `1px solid ${bandSt.border}`,
              background: "rgba(255,255,255,0.04)"
            }}
          >
            {geo.exposureBand}
          </span>
        ) : null}
      </div>
      <p style={{ margin: 0, fontSize: typography.scale.sm, color: colors.text, lineHeight: 1.45 }}>
        <strong>{geo.impactSectorLabel}</strong>
        {geo.eventDetails.length > 0 ? (
          <span style={{ color: colors.textMuted, fontWeight: 400 }}> · mapped sector vs headline themes</span>
        ) : null}
      </p>
      {geo.eventDetails.length > 0 ? (
        <ul
          style={{
            margin: 0,
            paddingLeft: "1.15rem",
            color: colors.textMuted,
            fontSize: typography.scale.sm,
            display: "grid",
            gap: spacing[1],
            listStyleType: "disc"
          }}
        >
          {geo.eventDetails.map((row) => (
            <li key={row.event_type} style={{ lineHeight: 1.5 }}>
              <span style={{ color: colors.text }}>{formatGeoEventTypeLabel(row.event_type)}</span>
              <span style={{ fontVariantNumeric: "tabular-nums", color: bandSt.fg }}> · {formatSectorMultiplier(row.sector_multiplier)}</span>
              <span style={{ fontSize: typography.scale.xs, opacity: 0.88 }}> for this sector</span>
            </li>
          ))}
        </ul>
      ) : null}
      {geo.exposureSummary ? (
        <p
          style={{
            margin: 0,
            fontSize: typography.scale.sm,
            lineHeight: 1.55,
            color: colors.text,
            borderTop: `1px solid ${colors.border}`,
            paddingTop: spacing[2]
          }}
        >
          {scrubGeoCopyForDisplay(geo.exposureSummary, geo.impactSectorLabel ?? "")}
        </p>
      ) : null}
    </div>
  );
}

export {
  statusColor,
  toneFromStatus,
  elevatedCardStyle,
  signalPriceDriftColor,
  tierVisualOverrides,
  formatLevel,
  displayUpdatedLabel,
  displayLayerFreshness,
  sectorResolutionLabel,
  sectorBenchmarkLabel,
  sectorLayerHasMomentumDetails,
  SectorMomentumPanel,
  technicalVwapChipPresentation,
  technicalOrbChipPresentation,
  confluenceChips,
  truncateCatalystTitle,
  formatCatalystSource,
  formatGeoEventTypeLabel,
  scrubGeoCopyForDisplay,
  geoExposureBandStyles,
  formatSectorMultiplier,
  GeoStructuralBaselinePanel,
  GeopoliticalExposurePanel,
};
