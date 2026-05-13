"""Multi-signal confluence scoring for intraday and swing contexts."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


CONFLUENCE_DISCLAIMER = (
    "Signal confluence data for informational purposes only. Not investment advice."
)

BULLISH_TERMS = frozenset(
    {
        "bullish",
        "bull",
        "positive",
        "risk_on",
        "favorable",
        "up",
        "long",
    }
)
BEARISH_TERMS = frozenset(
    {
        "bearish",
        "bear",
        "negative",
        "risk_off",
        "unfavorable",
        "down",
        "short",
    }
)


def _format_rel_vol(ratio: float) -> str:
    """Format a relative-volume ratio for chip labels with precision-preserving rules.

    Plain ``"{ratio:.1f}x avg"`` collapses small ratios (e.g. 0.42) to a misleading
    ``"0.0x avg"`` that reads as literal zero and undermines user trust. This helper:

    * Renders ratios in the ``[0.05, +inf)`` range with two decimal places so values
      like ``0.42`` display as ``0.42×`` rather than ``0.0×``.
    * Floors anything in the (0, 0.05) sliver to a clearly approximate ``"<0.05×"``
      so the label communicates a very-low-volume condition without faking zero.
    * Uses the multiplication sign (``×``) instead of the ASCII ``x`` to make the
      label visually distinct from a stray letter.
    """
    if ratio <= 0:
        return "0.00×"
    if ratio < 0.05:
        return "<0.05×"
    return f"{ratio:.2f}×"


def normalize_direction(value: str | None) -> str:
    """Map heterogeneous direction labels to bullish | bearish | neutral | mixed."""
    if not value:
        return "neutral"
    v = str(value).lower().strip()
    if v == "mixed":
        return "mixed"
    if v in ("avoid",):
        return "bearish"
    if v in BULLISH_TERMS:
        return "bullish"
    if v in BEARISH_TERMS:
        return "bearish"
    return "neutral"


def is_orb_long_pattern(pattern: str) -> bool:
    p = (pattern or "").lower()
    return "orb" in p and ("long" in p or "breakout" in p) and "short" not in p


def is_orb_short_pattern(pattern: str) -> bool:
    p = (pattern or "").lower()
    return "orb" in p and "short" in p


@dataclass(frozen=True)
class ConfluenceResult:
    symbol: str
    direction: str
    confluence_score: int
    tier: str
    confirming_signals: list[dict[str, Any]]
    conflicting_signals: list[dict[str, Any]]
    n_confirming: int
    n_conflicting: int
    is_confluence_alert: bool
    historical_note: str
    disclaimer: str


class ConfluenceDetector:
    """Score how many independent signal sources align on a symbol/direction."""

    SIGNAL_SOURCES = [
        "orb_breakout",
        "vwap_position",
        "ema_9_position",
        "market_regime",
        "sector_alignment",
        "internals_alignment",
        "volume_confirm",
        "news_catalyst",
        "gap_confirm",
    ]

    def calculate_confluence(
        self,
        symbol: str,
        direction: str,
        signal_data: dict[str, Any],
        snapshot: dict[str, Any],
        news_catalyst: dict[str, Any] | None,
        regime: str,
        sector_signal: str,
        internals_signal: str = "neutral",
    ) -> ConfluenceResult:
        confirming: list[dict[str, Any]] = []
        conflicting: list[dict[str, Any]] = []
        direction = (direction or "").strip().lower()
        regime_l = normalize_direction(regime)
        sector_l = normalize_direction(sector_signal)
        internals_l = normalize_direction(internals_signal)

        pattern = str(signal_data.get("pattern", "") or "").lower()

        # 1. ORB pattern
        if direction == "long" and is_orb_long_pattern(pattern):
            confirming.append(
                {
                    "source": "orb_breakout",
                    "label": "ORB Breakout Long",
                    "detail": "Price broke above opening range high",
                }
            )
        elif direction == "short" and is_orb_short_pattern(pattern):
            confirming.append(
                {
                    "source": "orb_breakout",
                    "label": "ORB Breakout Short",
                    "detail": "Price broke below opening range low",
                }
            )

        # 2. VWAP position
        price = float(snapshot.get("last_trade_price", 0) or signal_data.get("last_trade_price", 0) or 0)
        vwap = float(snapshot.get("day_vwap", 0) or 0)
        if price > 0 and vwap > 0:
            if direction == "long" and price > vwap:
                confirming.append(
                    {
                        "source": "vwap_position",
                        "label": "Above VWAP",
                        "detail": f"Price ${price:.2f} above VWAP ${vwap:.2f}",
                    }
                )
            elif direction == "short" and price < vwap:
                confirming.append(
                    {
                        "source": "vwap_position",
                        "label": "Below VWAP",
                        "detail": f"Price ${price:.2f} below VWAP ${vwap:.2f}",
                    }
                )
            elif direction in ("long", "short"):
                conflicting.append(
                    {
                        "source": "vwap_position",
                        "label": "VWAP conflict",
                        "detail": "Price on wrong side of VWAP for this setup",
                    }
                )

        # 3. EMA9 vs price (uses signal_data / snapshot)
        ema_raw = signal_data.get("ema9")
        if ema_raw is not None and price > 0:
            try:
                ema9 = float(ema_raw)
            except (TypeError, ValueError):
                ema9 = 0.0
            if ema9 > 0:
                if direction == "long" and price > ema9:
                    confirming.append(
                        {
                            "source": "ema_9_position",
                            "label": "Above 9 EMA",
                            "detail": f"Price ${price:.2f} above 9 EMA ${ema9:.2f}",
                        }
                    )
                elif direction == "short" and price < ema9:
                    confirming.append(
                        {
                            "source": "ema_9_position",
                            "label": "Below 9 EMA",
                            "detail": f"Price ${price:.2f} below 9 EMA ${ema9:.2f}",
                        }
                    )
                elif direction in ("long", "short"):
                    conflicting.append(
                        {
                            "source": "ema_9_position",
                            "label": "EMA conflict",
                            "detail": "Price on wrong side of 9 EMA for this setup",
                        }
                    )

        # 4. Market regime
        if direction == "long" and regime_l == "bullish":
            confirming.append(
                {
                    "source": "market_regime",
                    "label": "Bullish Regime",
                    "detail": "Macro conditions support long setups",
                }
            )
        elif direction == "short" and regime_l == "bearish":
            confirming.append(
                {
                    "source": "market_regime",
                    "label": "Bearish Regime",
                    "detail": "Macro conditions support short setups",
                }
            )
        elif regime_l in ("bullish", "bearish") and direction in ("long", "short"):
            conflicting.append(
                {
                    "source": "market_regime",
                    "label": "Regime conflict",
                    "detail": f"Market regime is {regime_l} — opposes this setup",
                }
            )

        # 5. Sector alignment
        #
        # Label invariants (BRK-B fix, 2026-05-13):
        #   - The chip label ALWAYS describes the sector's intrinsic
        #     direction *relative to SPY* — never the alignment with
        #     the setup. The ✓ / ✕ column (confirming vs conflicting)
        #     carries the alignment signal on its own.
        #   - The previous labels ("Sector Bullish" / "Sector Bearish"
        #     / "Sector conflict") read as a polarity verdict about
        #     the sector itself and triggered repeated user reports
        #     of the form "card says sector is bearish but it should
        #     be bullish" — the user was reading the chip as a verdict
        #     instead of a relative-strength readout. The new labels
        #     ("Sector leads market" / "Sector lags market") make the
        #     relative-strength framing explicit.
        sector_chip: dict[str, Any] | None = None
        if sector_l == "bullish":
            sector_chip = {
                "source": "sector_alignment",
                "label": "Sector leads market",
                "detail": "Sector ETF outperforming SPY (relative strength).",
            }
        elif sector_l == "bearish":
            sector_chip = {
                "source": "sector_alignment",
                "label": "Sector lags market",
                "detail": "Sector ETF underperforming SPY (relative strength).",
            }
        if sector_chip is not None and direction in ("long", "short"):
            aligned = (direction == "long" and sector_l == "bullish") or (
                direction == "short" and sector_l == "bearish"
            )
            if aligned:
                confirming.append(sector_chip)
            else:
                conflicting.append(sector_chip)

        # 6. Internals alignment (breadth + participation).
        #
        # Why this exists (BRK-B short-setup feedback, 2026-05-13):
        # Before this chip the Internals layer could be loudly bullish
        # (breadth strong-up, participation broad-up) on the layer-detail
        # card AND simultaneously absent from the Confirming/Conflicting
        # rail at the bottom of the evidence card. That made the most
        # important counter-signal to a short setup ("broad market is
        # rising while you're trying to short an individual name") invisible
        # to the user. Mirrors the sector_alignment design: the chip label
        # describes the breadth/participation state intrinsically; whether
        # it lands in confirming or conflicting is decided by setup direction.
        internals_chip: dict[str, Any] | None = None
        if internals_l == "bullish":
            internals_chip = {
                "source": "internals_alignment",
                "label": "Internals bullish",
                "detail": "Breadth and participation broadly up — broad market is rising.",
            }
        elif internals_l == "bearish":
            internals_chip = {
                "source": "internals_alignment",
                "label": "Internals bearish",
                "detail": "Breadth and participation broadly down — broad market is falling.",
            }
        if internals_chip is not None and direction in ("long", "short"):
            aligned = (direction == "long" and internals_l == "bullish") or (
                direction == "short" and internals_l == "bearish"
            )
            if aligned:
                confirming.append(internals_chip)
            else:
                conflicting.append(internals_chip)

        # 7. Volume confirmation
        vol_vs_avg = float(signal_data.get("volume_vs_avg", 0) or 0)
        if vol_vs_avg >= 1.5:
            confirming.append(
                {
                    "source": "volume_confirm",
                    "label": f"Strong Volume ({_format_rel_vol(vol_vs_avg)} avg)",
                    "detail": "Above average volume confirms participation",
                }
            )
        elif vol_vs_avg < 0.8 and vol_vs_avg > 0:
            conflicting.append(
                {
                    "source": "volume_confirm",
                    "label": f"Weak Volume ({_format_rel_vol(vol_vs_avg)} avg)",
                    "detail": "Below average volume reduces conviction",
                }
            )

        # 8. News catalyst
        if news_catalyst:
            sentiment_raw = str(news_catalyst.get("sentiment", "mixed") or "mixed").lower()
            sentiment = normalize_direction(sentiment_raw)
            headline = str(news_catalyst.get("headline", "") or "")[:80]
            if direction == "long" and sentiment == "bullish":
                confirming.append(
                    {
                        "source": "news_catalyst",
                        "label": "Bullish Catalyst",
                        "detail": headline,
                    }
                )
            elif direction == "short" and sentiment == "bearish":
                confirming.append(
                    {
                        "source": "news_catalyst",
                        "label": "Bearish Catalyst",
                        "detail": headline,
                    }
                )
            elif sentiment == "mixed":
                conflicting.append(
                    {
                        "source": "news_catalyst",
                        "label": "Mixed News",
                        "detail": "News sentiment unclear for this direction",
                    }
                )
            elif sentiment == "bearish" and direction == "long":
                conflicting.append(
                    {
                        "source": "news_catalyst",
                        "label": "Bearish Catalyst",
                        "detail": headline or "News opposes long direction",
                    }
                )
            elif sentiment == "bullish" and direction == "short":
                conflicting.append(
                    {
                        "source": "news_catalyst",
                        "label": "Bullish Catalyst",
                        "detail": headline or "News opposes short direction",
                    }
                )

        # 9. Gap confirmation
        gap_pct = float(signal_data.get("gap_pct", 0) or 0)
        if direction == "long" and gap_pct >= 1.0:
            confirming.append(
                {
                    "source": "gap_confirm",
                    "label": f"Gap Up +{gap_pct:.1f}%",
                    "detail": "Pre-market gap supports long momentum",
                }
            )
        elif direction == "short" and gap_pct <= -1.0:
            confirming.append(
                {
                    "source": "gap_confirm",
                    "label": f"Gap Down {gap_pct:.1f}%",
                    "detail": "Pre-market gap supports short momentum",
                }
            )

        n_confirming = len(confirming)
        n_conflicting = len(conflicting)
        denom = max(1, len(self.SIGNAL_SOURCES))
        raw = (n_confirming / denom) * 100.0
        penalty = n_conflicting * 8
        score = max(0, min(100, int(raw - penalty)))

        if score >= 80 and n_confirming >= 5:
            tier = "exceptional"
        elif score >= 65 and n_confirming >= 4:
            tier = "strong"
        elif score >= 50 and n_confirming >= 3:
            tier = "moderate"
        else:
            tier = "weak"

        return ConfluenceResult(
            symbol=symbol,
            direction=direction,
            confluence_score=score,
            tier=tier,
            confirming_signals=confirming,
            conflicting_signals=conflicting,
            n_confirming=n_confirming,
            n_conflicting=n_conflicting,
            is_confluence_alert=(n_confirming >= 3 and score >= 60),
            historical_note=self._historical_note(n_confirming),
            disclaimer=CONFLUENCE_DISCLAIMER,
        )

    def _historical_note(self, n: int) -> str:
        return {
            7: "7 signals aligning: strongest possible multi-layer confirmation",
            6: "6 confirming signals: very high conviction setup",
            5: "5 confirming signals: strong multi-layer confirmation",
            4: "4 confirming signals: solid confluence detected",
            3: "3 confirming signals: moderate confluence",
        }.get(n, "")


def confluence_result_to_response_fields(result: ConfluenceResult) -> dict[str, Any]:
    """Subset of ConfluenceResult for JSON APIs (excludes duplicate disclaimer when parent carries legal copy)."""
    return {
        "confluence_score": result.confluence_score,
        "confluence_tier": result.tier,
        "is_confluence_alert": result.is_confluence_alert,
        "confirming_signals": result.confirming_signals,
        "conflicting_signals": result.conflicting_signals,
        "n_confirming": result.n_confirming,
        "n_conflicting": result.n_conflicting,
        "historical_note": result.historical_note,
        "confluence_disclaimer": result.disclaimer,
    }
