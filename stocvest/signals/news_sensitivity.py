"""Per-symbol News / Geopolitical sensitivity weighting (B71 Phase A — static priors).

Some names are structurally headline-driven: biotech reprices on an FDA/trial
print, semis on export controls, energy on OPEC / Middle-East supply, banks and
EM ADRs on rates and sovereign risk. Others — utilities, staples, REITs — are
rarely moved by a single article. Today the composite blends a *flat* news
(``0.20``) and geopolitical (``0.10``) weight for **every** symbol. This module
supplies a coarse, **down-only** influence multiplier so low-sensitivity names
lean less on News/Geo and more on Technical / Sector / Macro structure.

Design constraints (deliberately conservative — see ``docs/BACKLOG.md`` B71):

* **Coarse buckets, not precise numbers** — ``HIGH / MEDIUM / LOW`` only, to avoid
  the false precision of a hand-tuned float on a static prior.
* **Down-only (multiplier ``<= 1.0``)** — ``HIGH`` keeps the full configured
  weight; we never *inflate* a layer above its weight on a static guess.
  Up-weighting waits for the data-driven event-study phase (B71 Phase C).
* **Recognized-sector-only** — unknown / ``default`` sectors stay neutral
  (``1.0``); we only down-weight when we positively recognize a low/medium
  sector, so behavior is unchanged for anything we cannot classify.
* **Soft weight, never a gate** — this only scales ``CompositeScoreEngine``
  effective weight (which renormalizes); it can never block, force, or flip a
  verdict on its own.

The multipliers map onto the composite layer ids ``"news"`` and
``"geopolitical"`` so they can be passed straight to
:meth:`CompositeScoreEngine.compute(..., sensitivity_multipliers=...)`.
"""

from __future__ import annotations

from enum import Enum
from typing import Any

from stocvest.signals.geo_sector_impact import normalize_sector_for_geo


class SensitivityBand(str, Enum):
    """Coarse, trader-legible sensitivity tier for a layer."""

    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


# Down-only influence multipliers. HIGH == unchanged vs the flat configured weight.
_BAND_MULTIPLIER: dict[SensitivityBand, float] = {
    SensitivityBand.HIGH: 1.0,
    SensitivityBand.MEDIUM: 0.85,
    SensitivityBand.LOW: 0.6,
}

# Hard guardrail: even if callers/config drift, sensitivity stays in a sane band.
SENSITIVITY_FLOOR = 0.5
SENSITIVITY_CEILING = 1.0

# ── News: how much a single-stock headline tends to reprice the name ──────────
# Recognized low/medium sectors only; everything else (incl. unknown) → HIGH 1.0.
_NEWS_LOW: frozenset[str] = frozenset(
    {"utilities", "real_estate", "consumer_staples", "staples", "consumer_defensive"}
)
_NEWS_MEDIUM: frozenset[str] = frozenset(
    {"financials", "industrials", "materials", "basic_materials"}
)

# ── Geopolitical: how much geo / macro-geo events tend to reprice the name ─────
_GEO_LOW: frozenset[str] = frozenset(
    {"healthcare", "software", "utilities", "real_estate", "consumer_staples", "staples", "consumer_defensive"}
)
_GEO_MEDIUM: frozenset[str] = frozenset(
    {"technology", "consumer_discretionary", "communication_services", "industrials"}
)
# Recognized high-exposure sectors are listed for intent/telemetry; the resolver
# treats "not low and not medium" as HIGH, so this set is informational.
_GEO_HIGH: frozenset[str] = frozenset(
    {"energy", "semiconductors", "defense", "airlines", "materials", "basic_materials", "financials", "banks"}
)


def _news_band(sector_key: str) -> SensitivityBand:
    if sector_key in _NEWS_LOW:
        return SensitivityBand.LOW
    if sector_key in _NEWS_MEDIUM:
        return SensitivityBand.MEDIUM
    return SensitivityBand.HIGH


def _geo_band(sector_key: str, *, is_adr: bool) -> SensitivityBand:
    # ADRs carry home-country policy / FX / sovereign risk — keep full geo weight.
    if is_adr:
        return SensitivityBand.HIGH
    if sector_key in _GEO_LOW:
        return SensitivityBand.LOW
    if sector_key in _GEO_MEDIUM:
        return SensitivityBand.MEDIUM
    return SensitivityBand.HIGH


def _is_adr(ticker_ref: Any | None) -> bool:
    if ticker_ref is None:
        return False
    is_adr_fn = getattr(ticker_ref, "is_adr", None)
    if not callable(is_adr_fn):
        return False
    try:
        return bool(is_adr_fn())
    except Exception:  # noqa: BLE001 — never let a reference quirk break scoring
        return False


def _clamp_multiplier(value: float) -> float:
    return max(SENSITIVITY_FLOOR, min(SENSITIVITY_CEILING, float(value)))


def layer_sensitivity_bands(
    sic_bucket: str | None,
    *,
    ticker_ref: Any | None = None,
) -> dict[str, SensitivityBand]:
    """Resolve coarse sensitivity bands for the News and Geopolitical layers.

    ``sic_bucket`` is the internal SIC / ETF-routing bucket (the same value the
    geo analyzer receives as ``sector_bucket``). Unknown / empty buckets resolve
    to ``HIGH`` (neutral — no down-weighting).
    """
    sector_key = normalize_sector_for_geo(str(sic_bucket or ""))
    is_adr = _is_adr(ticker_ref)
    return {
        "news": _news_band(sector_key),
        "geopolitical": _geo_band(sector_key, is_adr=is_adr),
    }


def layer_sensitivity_multipliers(
    sic_bucket: str | None,
    *,
    ticker_ref: Any | None = None,
) -> dict[str, float]:
    """Down-only influence multipliers for the News and Geopolitical layers.

    Returns ``{"news": m, "geopolitical": m}`` with each ``m`` in
    ``[SENSITIVITY_FLOOR, SENSITIVITY_CEILING]``. Pass straight to
    :meth:`CompositeScoreEngine.compute` as ``sensitivity_multipliers``. A
    name we cannot classify yields ``{"news": 1.0, "geopolitical": 1.0}`` →
    identical to pre-B71 behavior.
    """
    bands = layer_sensitivity_bands(sic_bucket, ticker_ref=ticker_ref)
    return {layer: _clamp_multiplier(_BAND_MULTIPLIER[band]) for layer, band in bands.items()}


def layer_sensitivity_payload(
    sic_bucket: str | None,
    *,
    ticker_ref: Any | None = None,
) -> dict[str, Any]:
    """Trader-legible News/Geo sensitivity for the API/UI (band + applied multiplier).

    Combines :func:`layer_sensitivity_bands` and :func:`layer_sensitivity_multipliers`
    into a single JSON-serializable object the deep-dive can render so it's clear what
    News/Geo weighting a given symbol is receiving today.
    """
    bands = layer_sensitivity_bands(sic_bucket, ticker_ref=ticker_ref)
    mults = layer_sensitivity_multipliers(sic_bucket, ticker_ref=ticker_ref)
    return {
        "sic_bucket": str(sic_bucket or "default"),
        "news": {"band": bands["news"].value, "multiplier": round(mults["news"], 4)},
        "geopolitical": {
            "band": bands["geopolitical"].value,
            "multiplier": round(mults["geopolitical"], 4),
        },
    }
