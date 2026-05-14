/**
 * Signal-price drift display helper (B36, 2026-05-13).
 *
 * Surfaces the price the engine used when it computed the signal
 * (`priceAtSignal`, captured at the scanner emit moment T0) alongside
 * the most recent snapshot price the evidence card has on hand
 * (`currentPrice`, captured when the user opened the card, T1), plus
 * the percentage drift between them.
 *
 * Why this exists:
 *
 *   - Every reference level on an evidence card (entry zone, target
 *     levels, stop, R/R, VWAP context) is computed against the
 *     T0 price. When T1 has drifted far from T0, those levels start
 *     describing a setup that no longer exists at today's price.
 *
 *   - The user can read the drift number and decide whether to plan
 *     around the engine's reference geometry or wait for a fresh
 *     evaluation. The helper deliberately does NOT recommend an
 *     action — it surfaces data and leaves the call to the user.
 *
 * Direction-aware coloring is deliberately rejected: a positive Δ is
 * neither "good" nor "bad" without knowing the setup direction
 * (positive Δ helps a long, hurts a short), and the user reads the
 * card with full direction context elsewhere. We instead band on
 * *magnitude* — small drift is muted, moderate drift bumps text color,
 * and large drift uses the platform's caution / warning tones to
 * signal "the reference levels may be stale."
 *
 * Lock-in tests live in `frontend/tests/signal-price-display.test.ts`.
 */

/**
 * Drift band used to color the delta and surface staleness warnings.
 *
 *   - `none`     — Δ is exactly 0 or both prices are equal within
 *                  floating-point tolerance. Render the row but use
 *                  the most muted styling.
 *   - `marginal` — |Δ| < 1%. Within typical bid-ask + tick noise; the
 *                  reference levels are still meaningful.
 *   - `moderate` — 1% ≤ |Δ| < 3%. Noticeable drift; the levels still
 *                  apply but the user should be aware.
 *   - `elevated` — 3% ≤ |Δ| < 5%. The setup is shifting; structured
 *                  scenarios become less reliable.
 *   - `stale`    — |Δ| ≥ 5%. The reference geometry materially no
 *                  longer matches the live price; user should treat
 *                  the card as a historical read.
 */
export type SignalPriceDriftTier = "none" | "marginal" | "moderate" | "elevated" | "stale";

/**
 * Pure display payload the evidence card consumes when rendering the
 * Signal Price drift row. All numeric fields are guaranteed finite +
 * positive when present; helper returns `null` for the whole row when
 * neither side of the comparison is usable.
 */
export interface SignalPriceDisplay {
  /** Price the engine used when it computed the signal (T0). */
  priceAtSignal: number | null;
  /** Most recent snapshot price the card has on hand (T1). */
  currentPrice: number | null;
  /**
   * Δ as a percentage of `priceAtSignal`, signed. `null` when either
   * side is missing — the row still renders the available side.
   */
  deltaPct: number | null;
  /**
   * Drift band keyed on `Math.abs(deltaPct)`. `null` when `deltaPct`
   * is null (no comparison to band).
   */
  driftTier: SignalPriceDriftTier | null;
  /**
   * Compact accessible label describing what the row conveys —
   * used as the `aria-label` on the row container so screen readers
   * read a single sentence instead of three visual fragments.
   */
  accessibleLabel: string;
}

const PRICE_EPS = 1e-9;

function sanitizePrice(raw: number | null | undefined): number | null {
  if (typeof raw !== "number") return null;
  if (!Number.isFinite(raw)) return null;
  if (raw <= PRICE_EPS) return null;
  return raw;
}

/**
 * Bucket `|deltaPct|` into a `SignalPriceDriftTier`. Boundaries are
 * inclusive on the LOWER edge per the JSDoc above (so exactly 1% is
 * `moderate`, exactly 3% is `elevated`, exactly 5% is `stale`).
 *
 * Exported so tests can pin the boundaries without re-importing the
 * full helper, and so the render path can reuse the bucketer if it
 * ever needs to band a drift from a non-priceAtSignal source.
 */
export function signalPriceDriftTier(deltaPct: number): SignalPriceDriftTier {
  const m = Math.abs(deltaPct);
  if (m < PRICE_EPS) return "none";
  if (m < 1) return "marginal";
  if (m < 3) return "moderate";
  if (m < 5) return "elevated";
  return "stale";
}

/**
 * Format a USD-style price for inline display. Two decimal places to
 * match the rest of the evidence card; never returns a NaN string.
 */
export function formatSignalPrice(value: number): string {
  return `$${value.toFixed(2)}`;
}

/**
 * Format a signed percentage for inline display (`+1.1%`, `-3.4%`,
 * `0.0%` when the value rounds to zero). One decimal place is the
 * sweet spot — coarse enough to be readable, fine enough to surface
 * sub-1% drift.
 */
export function formatSignalPriceDeltaPct(deltaPct: number): string {
  const rounded = Number(deltaPct.toFixed(1));
  if (Math.abs(rounded) < 0.05) return "0.0%";
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)}%`;
}

/**
 * Build the full display payload for the Signal Price row.
 *
 * @param priceAtSignal - Price the engine used at signal emit (T0).
 * @param currentPrice  - Price the card has on hand right now (T1).
 * @returns `SignalPriceDisplay` when at least one price is usable;
 *          `null` when both sides are missing (no row to render).
 */
export function computeSignalPriceDisplay(
  priceAtSignal: number | null | undefined,
  currentPrice: number | null | undefined
): SignalPriceDisplay | null {
  const t0 = sanitizePrice(priceAtSignal);
  const t1 = sanitizePrice(currentPrice);

  if (t0 == null && t1 == null) return null;

  let deltaPct: number | null = null;
  let driftTier: SignalPriceDriftTier | null = null;
  if (t0 != null && t1 != null) {
    deltaPct = ((t1 - t0) / t0) * 100;
    driftTier = signalPriceDriftTier(deltaPct);
  }

  const accessibleLabel = buildAccessibleLabel(t0, t1, deltaPct);

  return {
    priceAtSignal: t0,
    currentPrice: t1,
    deltaPct,
    driftTier,
    accessibleLabel
  };
}

/**
 * Compose a single-sentence accessible description of the row.
 *
 *   - Both sides present: "Signal computed at $X. Current price $Y.
 *     Δ +Z.Z percent."
 *   - Only T0 present: "Signal computed at $X. Current price
 *     unavailable."
 *   - Only T1 present: "Signal computed-at price unavailable. Current
 *     price $Y."
 *
 * Avoids icons / arrows / abbreviations that screen readers stumble
 * on; pronounces "Δ" as "delta" via the literal word.
 */
function buildAccessibleLabel(
  t0: number | null,
  t1: number | null,
  deltaPct: number | null
): string {
  if (t0 != null && t1 != null && deltaPct != null) {
    const sign = deltaPct > 0.05 ? "up" : deltaPct < -0.05 ? "down" : "unchanged";
    const magnitude = Math.abs(Number(deltaPct.toFixed(1))).toFixed(1);
    return (
      `Signal computed at ${formatSignalPrice(t0)}. ` +
      `Current price ${formatSignalPrice(t1)}. ` +
      `Drift ${sign} ${magnitude} percent since signal.`
    );
  }
  if (t0 != null) {
    return `Signal computed at ${formatSignalPrice(t0)}. Current price unavailable.`;
  }
  if (t1 != null) {
    return `Signal computed-at price unavailable. Current price ${formatSignalPrice(t1)}.`;
  }
  // Unreachable — caller already gated on the both-null case — but
  // keep the branch so the type signature is exhaustive.
  return "Signal price unavailable.";
}
