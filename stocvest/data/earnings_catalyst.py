"""Map earnings calendar rows to gap-intelligence catalyst payloads."""

from __future__ import annotations

from datetime import date, timedelta

from stocvest.data.models import EarningsEvent


def _norm_report_time(raw: str) -> str:
    s = (raw or "").strip().lower()
    if s in ("before_market", "bmo", "premarket", "pre-market"):
        return "before_market"
    if s in ("after_market", "amc", "postmarket", "post-market"):
        return "after_market"
    if s in ("during_market", "dmh"):
        return "during_market"
    return "unknown"


def earnings_applies_to_gap_session(
    report_date: date,
    report_time: str,
    *,
    session_date: date,
) -> bool:
    """
    Whether an earnings report explains a gap on ``session_date``.

    - BMO on session_date → gap at open same day.
    - AMC on session_date - 1 → gap at open on session_date.
    - Unknown timing: report on session_date or prior session only (conservative).
    """
    rt = _norm_report_time(report_time)
    if rt == "before_market" and report_date == session_date:
        return True
    if rt == "after_market" and report_date == session_date - timedelta(days=1):
        return True
    if rt == "during_market" and report_date == session_date:
        return True
    if rt == "unknown" and report_date in (session_date, session_date - timedelta(days=1)):
        return True
    return False


def earnings_catalyst_payload(
    event: EarningsEvent,
    *,
    session_date: date,
) -> dict[str, str] | None:
    if not earnings_applies_to_gap_session(event.report_date, event.report_time, session_date=session_date):
        return None
    rt = _norm_report_time(event.report_time)
    timing = {
        "before_market": "before the open",
        "after_market": "after the close",
        "during_market": "during the session",
    }.get(rt, "scheduled")
    headline = f"{event.symbol} earnings {timing} ({event.report_date.isoformat()})"
    if event.actual_eps is not None:
        headline = f"{event.symbol} reported earnings {timing} — EPS {event.actual_eps}"
    return {
        "article_id": f"earnings:{event.symbol}:{event.report_date.isoformat()}",
        "headline": headline,
        "category": "earnings",
        "sentiment": "neutral",
        "score": 72,
        "source": "earnings_calendar",
    }


def match_earnings_catalyst(
    symbol: str,
    events_by_symbol: dict[str, list[EarningsEvent]],
    *,
    session_date: date | None = None,
) -> tuple[dict[str, str] | None, EarningsEvent | None]:
    """Best earnings catalyst for ``symbol`` on ``session_date`` (default today ET)."""
    sym = symbol.strip().upper()
    if not sym:
        return None, None
    sess = session_date or date.today()
    for ev in events_by_symbol.get(sym, []):
        payload = earnings_catalyst_payload(ev, session_date=sess)
        if payload is not None:
            return payload, ev
    return None, None
