"""Fundamental backdrop for swing evidence — display-only, never scored."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from stocvest.data.benzinga_client import (
    BenzingaEarningsResult,
    BenzingaGuidance,
    BenzingaMultiResult,
    BenzingaRating,
)
from stocvest.data.fmp_client import get_revenue_trend
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

FundamentalBackdrop = Literal["positive", "neutral", "mixed", "weak"]
TrendDirection = Literal["growing", "flat", "declining", "unknown"]
GuidanceDir = Literal["raised", "lowered", "maintained", "unknown"]
AnalystDir = Literal["upgrading", "downgrading", "stable", "unknown"]
EarningsTrend = Literal["beating", "missing", "inline", "unknown"]
DataQuality = Literal["high", "medium", "low"]


@dataclass(frozen=True)
class FundamentalContext:
    symbol: str
    backdrop: FundamentalBackdrop
    earnings_trend: EarningsTrend
    guidance_direction: GuidanceDir
    analyst_direction: AnalystDir
    revenue_trend: TrendDirection
    summary_line: str
    data_quality: DataQuality
    quarters_beating: int = 0
    quarters_missing: int = 0
    recent_upgrades: int = 0
    recent_downgrades: int = 0
    sector_display_name: str | None = None
    sector_etf: str | None = None

    def to_api_dict(self) -> dict[str, Any]:
        return {
            "backdrop": self.backdrop,
            "earnings_trend": self.earnings_trend,
            "guidance_direction": self.guidance_direction,
            "analyst_direction": self.analyst_direction,
            "revenue_trend": self.revenue_trend,
            "summary_line": self.summary_line,
            "data_quality": self.data_quality,
            "quarters_beating": self.quarters_beating,
            "quarters_missing": self.quarters_missing,
            "recent_upgrades": self.recent_upgrades,
            "recent_downgrades": self.recent_downgrades,
            "sector_display_name": self.sector_display_name,
            "sector_etf": self.sector_etf,
        }


def _neutral_context(symbol: str) -> FundamentalContext:
    sym = symbol.strip().upper() or "—"
    return FundamentalContext(
        symbol=sym,
        backdrop="neutral",
        earnings_trend="unknown",
        guidance_direction="unknown",
        analyst_direction="unknown",
        revenue_trend="unknown",
        summary_line=f"Fundamental context limited for {sym}. Signal data only.",
        data_quality="low",
    )


def _compute_earnings_trend(results: list[BenzingaEarningsResult]) -> tuple[EarningsTrend, int, int]:
    if not results:
        return "unknown", 0, 0
    recent = sorted(results, key=lambda r: r.reported_at, reverse=True)[:4]
    beats = sum(1 for r in recent if r.beat is True)
    misses = sum(1 for r in recent if r.beat is False)
    if not recent:
        return "unknown", 0, 0
    if beats >= 3:
        return "beating", beats, misses
    if misses >= 3:
        return "missing", beats, misses
    return "inline", beats, misses


def _compute_guidance_direction(guidance_items: list[BenzingaGuidance]) -> GuidanceDir:
    if not guidance_items:
        return "unknown"
    recent = sorted(guidance_items, key=lambda g: g.published_at, reverse=True)
    g = recent[0]
    gt = (g.guidance_type or "").strip().lower()
    if gt == "raised":
        return "raised"
    if gt in ("lowered", "cut"):
        return "lowered"
    if gt:
        return "maintained"
    return "unknown"


def _compute_analyst_direction(ratings: list[BenzingaRating]) -> tuple[AnalystDir, int, int]:
    if not ratings:
        return "unknown", 0, 0
    from stocvest.signals.analyst_rating_score import CONSENSUS_WINDOW_DAYS, consensus_counts

    upgrades, downgrades, momentum = consensus_counts(ratings, window_days=CONSENSUS_WINDOW_DAYS)
    if upgrades == 0 and downgrades == 0:
        return "unknown", upgrades, downgrades
    if momentum >= 3:
        return "upgrading", upgrades, downgrades
    if momentum <= -3:
        return "downgrading", upgrades, downgrades
    if upgrades > downgrades:
        return "upgrading", upgrades, downgrades
    if downgrades > upgrades:
        return "downgrading", upgrades, downgrades
    return "stable", upgrades, downgrades


def _compute_backdrop(
    *,
    earnings_trend: EarningsTrend,
    guidance_dir: GuidanceDir,
    analyst_dir: AnalystDir,
    revenue_trend: TrendDirection,
) -> FundamentalBackdrop:
    score = 0
    pairs: list[tuple[EarningsTrend | GuidanceDir | AnalystDir | TrendDirection, str, str]] = [
        (earnings_trend, "beating", "missing"),
        (guidance_dir, "raised", "lowered"),
        (analyst_dir, "upgrading", "downgrading"),
        (revenue_trend, "growing", "declining"),
    ]
    for actual, pos, neg in pairs:
        if actual == pos:
            score += 1
        elif actual == neg:
            score -= 1
    if score >= 2:
        return "positive"
    if score >= 0:
        return "neutral"
    if score == -1:
        return "mixed"
    return "weak"


def _build_summary_line(
    *,
    symbol: str,
    backdrop: FundamentalBackdrop,
    earnings_trend: EarningsTrend,
    guidance_dir: GuidanceDir,
    analyst_dir: AnalystDir,
    data_quality: DataQuality,
) -> str:
    if data_quality == "low":
        return f"Fundamental context limited for {symbol}. Signal data only."
    parts: list[str] = []
    if earnings_trend == "beating":
        parts.append("beating earnings")
    elif earnings_trend == "missing":
        parts.append("missing earnings")
    if guidance_dir == "raised":
        parts.append("guidance raised")
    elif guidance_dir == "lowered":
        parts.append("guidance cut")
    if analyst_dir == "upgrading":
        parts.append("analyst upgrades")
    elif analyst_dir == "downgrading":
        parts.append("analyst downgrades")
    label = {
        "positive": "Fundamentals positive",
        "neutral": "Fundamentals neutral",
        "mixed": "Fundamentals mixed",
        "weak": "Fundamentals weak",
    }[backdrop]
    if not parts:
        return f"Fundamental context limited for {symbol}. Signal data only."
    return f"{label} — {', '.join(parts)}. Signal data only."


async def build_fundamental_context(
    symbol: str,
    *,
    benzinga_multi: BenzingaMultiResult | None = None,
    sector_display_name: str | None = None,
    sector_etf: str | None = None,
) -> FundamentalContext:
    """
    Build display-only fundamental backdrop from Benzinga multi (reused when provided).

    Never raises. Does not affect composite score or alignment.
    """
    sym = symbol.strip().upper()
    if not sym:
        return _neutral_context("—")

    earnings_results: list[BenzingaEarningsResult] = []
    ratings: list[BenzingaRating] = []
    guidance_items: list[BenzingaGuidance] = []

    if benzinga_multi is not None:
        earnings_results = list(benzinga_multi.earnings or [])
        ratings = list(benzinga_multi.ratings or [])
        guidance_items = list(benzinga_multi.guidance or [])

    earnings_trend, beats, misses = _compute_earnings_trend(earnings_results)
    guidance_dir = _compute_guidance_direction(guidance_items)
    analyst_dir, upgrades, downgrades = _compute_analyst_direction(ratings)
    revenue_trend: TrendDirection = "unknown"
    try:
        revenue_trend = await get_revenue_trend(sym)
    except Exception as exc:
        _LOG.warning("fundamental_fmp_revenue_failed symbol=%s err=%s", sym, type(exc).__name__)

    backdrop = _compute_backdrop(
        earnings_trend=earnings_trend,
        guidance_dir=guidance_dir,
        analyst_dir=analyst_dir,
        revenue_trend=revenue_trend,
    )

    sources_hit = sum(
        [
            bool(earnings_results),
            bool(ratings),
            bool(guidance_items),
            revenue_trend != "unknown",
        ]
    )
    quality: DataQuality = "high" if sources_hit >= 3 else ("medium" if sources_hit >= 1 else "low")

    summary = _build_summary_line(
        symbol=sym,
        backdrop=backdrop,
        earnings_trend=earnings_trend,
        guidance_dir=guidance_dir,
        analyst_dir=analyst_dir,
        data_quality=quality,
    )

    return FundamentalContext(
        symbol=sym,
        backdrop=backdrop,
        earnings_trend=earnings_trend,
        guidance_direction=guidance_dir,
        analyst_direction=analyst_dir,
        revenue_trend=revenue_trend,
        summary_line=summary,
        data_quality=quality,
        quarters_beating=beats,
        quarters_missing=misses,
        recent_upgrades=upgrades,
        recent_downgrades=downgrades,
        sector_display_name=(sector_display_name or "").strip() or None,
        sector_etf=(sector_etf or "").strip().upper() or None,
    )
