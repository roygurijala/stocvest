"""
Structured morning brief (dashboard): market conditions, calendars, top watch, setup hint, PDT.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Any

from stocvest.signals.pdt_tracker import PDTAssessment


@dataclass
class EconomicEventBrief:
    time: str
    event_name: str
    impact: str  # high | medium | low


@dataclass
class EarningsBriefRow:
    symbol: str
    company: str
    time: str  # BMO | AMC | DURING | TBD
    est_eps: float | None


@dataclass
class MorningBriefContext:
    briefing_date: date
    futures_spy_pct: float | None
    futures_qqq_pct: float | None
    vix_level: float | None
    vix_direction: str  # rising | falling | flat
    regime: str  # Bullish | Neutral | Bearish
    economic_events: list[EconomicEventBrief] = field(default_factory=list)
    earnings_today: list[EarningsBriefRow] = field(default_factory=list)
    gap_intelligence_items: list[dict[str, Any]] = field(default_factory=list)
    pdt: PDTAssessment | None = None


def _trading_conditions_label(regime: str, vix: float | None, spy_pct: float | None) -> str:
    r = regime.strip()
    v = float(vix) if vix is not None else 18.0
    spy = float(spy_pct) if spy_pct is not None else 0.0
    if r == "Bearish" or (vix is not None and vix > 25) or (spy_pct is not None and spy_pct < -1.0):
        return "AVOID"
    if r == "Neutral" or (20.0 <= v <= 25.0):
        return "CHOPPY"
    if r == "Bullish" and v < 20.0 and spy > 0.0:
        return "FAVORABLE"
    return "CHOPPY"


def _best_setup(conditions: str, regime: str) -> dict[str, Any]:
    if conditions == "FAVORABLE":
        if regime == "Bearish":
            return {
                "setup_type": "ORB Short",
                "guidance": (
                    "Favor short breakdowns below pre-market low. Bearish regime supports downside continuation."
                ),
            }
        return {
            "setup_type": "ORB Long",
            "guidance": (
                "Favor long breakouts above pre-market high in first 30 min. "
                "Strong conditions support momentum continuation."
            ),
        }
    if conditions == "CHOPPY":
        return {
            "setup_type": "High conviction only",
            "guidance": (
                "Mixed conditions. Only trade setups with 70%+ signal strength. "
                "Reduce position size. Wait for clear direction after 10 AM."
            ),
        }
    return {
        "setup_type": "Consider sitting out",
        "guidance": (
            "High risk conditions today. Paper trade only or reduce activity significantly."
        ),
    }


def _pdt_section(pdt: PDTAssessment | None) -> dict[str, Any]:
    if pdt is None:
        return {
            "trades_used": 0,
            "trades_remaining": 3,
            "status": "clear",
            "message": "Connect a broker to track PDT status.",
        }
    if pdt.pdt_exempt:
        return {
            "trades_used": pdt.day_trades_in_window,
            "trades_remaining": max(0, pdt.max_non_exempt),
            "status": "clear",
            "message": "PDT-exempt account.",
        }
    used = int(pdt.day_trades_in_window)
    cap = int(pdt.max_non_exempt)
    rem = max(0, cap - used)
    if used >= cap or pdt.at_limit:
        return {
            "trades_used": used,
            "trades_remaining": 0,
            "status": "blocked",
            "message": "PDT limit reached — paper mode recommended today",
        }
    if used == 2 or pdt.warn_near_limit:
        return {
            "trades_used": used,
            "trades_remaining": rem,
            "status": "warning",
            "message": "1 day trade remaining — trade carefully",
        }
    return {
        "trades_used": used,
        "trades_remaining": rem,
        "status": "clear",
        "message": f"{rem} day trades remaining this week",
    }


def _top_watch(items: list[dict[str, Any]]) -> dict[str, Any] | None:
    with_cat = [x for x in items if x.get("has_catalyst")]
    pool = with_cat if with_cat else []
    if not pool:
        return None
    pool.sort(key=lambda x: int(x.get("gap_quality_score") or 0), reverse=True)
    best = pool[0]
    cat = best.get("catalyst") or {}
    return {
        "symbol": best["symbol"],
        "company_name": best.get("company_name") or "",
        "gap_pct": best["gap_pct"],
        "current_price": best["current_price"],
        "volume_vs_avg": best["volume_vs_avg"],
        "catalyst": {
            "headline": cat.get("headline"),
            "sentiment": cat.get("sentiment"),
        },
    }


def build_morning_brief_payload(ctx: MorningBriefContext) -> dict[str, Any]:
    cond_label = _trading_conditions_label(ctx.regime, ctx.vix_level, ctx.futures_spy_pct)
    econ = ctx.economic_events[:3]
    econ_impact_order = {"high": 0, "medium": 1, "low": 2}
    econ_sorted = sorted(econ, key=lambda e: econ_impact_order.get(e.impact, 3))

    earnings_payload: list[dict[str, Any]] = [
        {
            "symbol": e.symbol,
            "company": e.company,
            "time": e.time,
            "est_eps": e.est_eps,
        }
        for e in ctx.earnings_today
    ]

    if econ_sorted:
        economic_out: list[dict[str, Any]] | dict[str, str] = [
            {"time": e.time, "event_name": e.event_name, "impact": e.impact} for e in econ_sorted
        ]
    else:
        economic_out = {"message": "No major economic events scheduled today"}

    if earnings_payload:
        earnings_out: list[dict[str, Any]] | dict[str, str] = earnings_payload
    else:
        earnings_out = {"message": "No earnings today"}

    top = _top_watch(ctx.gap_intelligence_items)
    top_out: dict[str, Any] | None
    if top is not None:
        top_out = top
    else:
        top_out = {"message": "No significant pre-market gaps today"}

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "conditions": {
            "label": cond_label,
            "futures_spy_pct": ctx.futures_spy_pct,
            "futures_qqq_pct": ctx.futures_qqq_pct,
            "vix_level": ctx.vix_level,
            "vix_direction": ctx.vix_direction,
            "regime": ctx.regime,
        },
        "economic_events": economic_out,
        "earnings_today": earnings_out,
        "top_watch": top_out,
        "best_setup": _best_setup(cond_label, ctx.regime),
        "pdt_status": _pdt_section(ctx.pdt),
    }


def infer_regime(spy_pct: float | None, qqq_pct: float | None, vix: float | None) -> str:
    spy = spy_pct if spy_pct is not None else 0.0
    qqq = qqq_pct if qqq_pct is not None else spy
    v = vix if vix is not None else 18.0
    if spy < -0.3 or qqq < -0.35 or v > 22:
        return "Bearish"
    if spy > 0.2 and qqq > 0.15 and v < 20:
        return "Bullish"
    return "Neutral"


def vix_direction_from_change(change_pct: float | None) -> str:
    if change_pct is None:
        return "flat"
    if change_pct > 0.05:
        return "rising"
    if change_pct < -0.05:
        return "falling"
    return "flat"
