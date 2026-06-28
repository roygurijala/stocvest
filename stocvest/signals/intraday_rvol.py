"""Time-of-day-normalized intraday relative volume (participation).

Conventional "RVOL" answers *are we trading more or less than normal for this
point in the session* — i.e. cumulative volume so far divided by the volume a
typical day would have completed **by this clock time**. It is centered around
1.0 (1.0 = average pace, 2.0 = twice normal pace, 0.5 = half).

This module computes that from data already on the snapshot — ``day_volume``
(cumulative session volume) and ``prev_day_volume`` (an ADV proxy) — using a
static US-equity intraday **cumulative** volume curve (the well-known U-shape:
heavy at the open, light midday, accelerating into the close).

Why this and not ``TechnicalResult.volume_vs_adv``: that field is
``last_bar_volume / ADV`` — a single intraday bar over a whole day's average, so
it is structurally ``<< 1`` and time-of-day biased (a midday probe of the 60-day
qualified cohort found **all 343** day signals < 1.0). It cannot serve as a
participation gate. This metric can.

Pure + dependency-free so it is cheap to compute on the hot path and easy to
unit-test. Returns ``None`` when inputs are missing or the session has not opened.
"""

from __future__ import annotations

from datetime import datetime, timezone
from zoneinfo import ZoneInfo

_ET = ZoneInfo("America/New_York")
_OPEN_MIN = 9 * 60 + 30  # 09:30 ET
_CLOSE_MIN = 16 * 60  # 16:00 ET

# Typical fraction of a regular session's total volume completed by N minutes
# after the 09:30 ET open. Piecewise-linear between these anchors (US large-cap
# equity U-shape: ~13% in the first 30 min, a slow midday, ~14% in the last 30).
# Source: standard intraday volume-profile literature; approximate by design —
# this is a baseline for a *relative* measure, not a per-symbol profile.
_CUM_VOLUME_CURVE: tuple[tuple[int, float], ...] = (
    (0, 0.0),
    (30, 0.13),    # 10:00
    (60, 0.21),    # 10:30
    (90, 0.28),    # 11:00
    (120, 0.34),   # 11:30
    (150, 0.40),   # 12:00
    (180, 0.45),   # 12:30
    (210, 0.50),   # 13:00
    (240, 0.56),   # 13:30
    (270, 0.62),   # 14:00
    (300, 0.69),   # 14:30
    (330, 0.77),   # 15:00
    (360, 0.86),   # 15:30
    (390, 1.0),    # 16:00
)


def _to_et(ref: datetime) -> datetime:
    if ref.tzinfo is None:
        ref = ref.replace(tzinfo=timezone.utc)
    return ref.astimezone(_ET)


def cumulative_volume_fraction(ref: datetime) -> float | None:
    """Fraction (0, 1] of a typical session's volume completed by ``ref`` (any tz).

    ``None`` before the open; clamped to 1.0 at/after the close.
    """
    et = _to_et(ref)
    mins = et.hour * 60 + et.minute
    if mins < _OPEN_MIN:
        return None
    if mins >= _CLOSE_MIN:
        return 1.0
    off = mins - _OPEN_MIN
    prev_x, prev_y = _CUM_VOLUME_CURVE[0]
    for x, y in _CUM_VOLUME_CURVE[1:]:
        if off <= x:
            span = x - prev_x
            frac = (off - prev_x) / span if span > 0 else 0.0
            val = prev_y + frac * (y - prev_y)
            return max(1e-4, min(1.0, val))
        prev_x, prev_y = x, y
    return 1.0


def session_relative_volume(
    day_volume: float | None,
    adv: float | None,
    ref: datetime,
) -> float | None:
    """Time-of-day-normalized RVOL ≈ ``day_volume / (adv * fraction(ref))``.

    1.0 = average pace for this time of day; 2.0 = twice normal; 0.5 = half.
    Returns ``None`` when ``day_volume``/``adv`` are missing or non-positive, or
    before the session opens (no meaningful fraction yet).
    """
    try:
        dv = float(day_volume) if day_volume is not None else None
        a = float(adv) if adv is not None else None
    except (TypeError, ValueError):
        return None
    if dv is None or a is None or dv < 0 or a <= 0:
        return None
    frac = cumulative_volume_fraction(ref)
    if frac is None or frac <= 0:
        return None
    expected = a * frac
    if expected <= 0:
        return None
    return round(dv / expected, 4)
