"""Shared VIX snapshot usability checks (dashboard, morning brief, Polygon parsers)."""

from __future__ import annotations

from stocvest.data.models import Snapshot


def snapshot_has_usable_vix_pulse(snap: Snapshot | None) -> bool:
    """True when UI can show a VIX level and/or session % (matches dashboard tape checks)."""
    if snap is None:
        return False
    for field in (snap.last_trade_price, snap.day_close):
        if isinstance(field, (int, float)) and field == field and field > 0:
            return True
    for attr in ("change_percent", "pre_market_change_percent", "after_hours_change_percent"):
        v = getattr(snap, attr, None)
        if isinstance(v, (int, float)) and v == v and v > -99.5:
            return True
    return False


def vix_level_from_snapshot(snap: Snapshot | None) -> float | None:
    """Prefer last print; fall back to index session close (Polygon omits last on some ticks)."""
    if snap is None:
        return None
    for field in (snap.last_trade_price, snap.day_close):
        if isinstance(field, (int, float)) and field == field and field > 0:
            return float(field)
    return None
