"""US/Eastern session windows for validation ledger entry (event timing only).

Entry *eligibility* gates live in ``signal_validation_eligibility``; this module only encodes
clock rules: swing ledger rows are logged in a short window after the cash close; day rows
only during regular trading hours.
"""

from __future__ import annotations

from datetime import date, datetime, time, timezone
from typing import Final
from zoneinfo import ZoneInfo

_ET: Final = ZoneInfo("America/New_York")

# Swing: log at daily close — allow a short post-close window for latency (Lambda / API).
SWING_LEDGER_ENTRY_START_ET: Final = time(15, 50)
SWING_LEDGER_ENTRY_END_ET: Final = time(16, 15)

# Day: RTH only (09:30–16:00 ET), exclusive of 16:00 close bar handling.
DAY_RTH_OPEN_ET: Final = time(9, 30)
DAY_RTH_LAST_ENTRY_ET: Final = time(15, 59)

# Day: midday low-quality "dead zone". 60-day as-traded replay shows day-desk
# signals fired 12:00–14:00 ET average ≈ −1.0%/trade (vs ≈ −0.21% in the 14:00–16:00
# window and +0.27% in the 9:30–10:00 opening). Flag-gated; window env-overridable.
DAY_DEADZONE_START_ET: Final = time(12, 0)
DAY_DEADZONE_END_ET: Final = time(14, 0)

# Day monitor: discretionary flatten before the bell (first-hit ordering in monitor).
DAY_FLATTEN_CUTOFF_ET: Final = time(15, 55)

# Swing: max calendar days an open validation row may persist before forced exit.
MAX_HOLD_CALENDAR_DAYS_SWING: Final = 20

# Minimum session cumulative volume on entry snapshot (day ledger liquidity gate).
MIN_SESSION_VOLUME_SHARES_DAY_LEDGER: Final = 100_000.0


def _is_weekday_et(d: date) -> bool:
    return d.weekday() < 5


def now_et(utc: datetime) -> datetime:
    if utc.tzinfo is None:
        utc = utc.replace(tzinfo=timezone.utc)
    return utc.astimezone(_ET)


def build_regime_window_key(macro_market_regime: str, ref_utc: datetime) -> str:
    """One validation window label per calendar month + coarse macro label (audit / dedupe)."""
    reg = str(macro_market_regime or "neutral").strip().lower().replace(" ", "_")[:32]
    et = now_et(ref_utc)
    return f"{reg}_{et.year:04d}-{et.month:02d}"


def is_swing_ledger_entry_window_et(ref_utc: datetime) -> bool:
    """Swing validation entries are only logged in the post–daily-close window, weekdays."""
    et = now_et(ref_utc)
    if not _is_weekday_et(et.date()):
        return False
    t = et.time()
    return SWING_LEDGER_ENTRY_START_ET <= t <= SWING_LEDGER_ENTRY_END_ET


def is_day_ledger_entry_session_et(ref_utc: datetime) -> bool:
    """Day validation entries only during US equity RTH."""
    et = now_et(ref_utc)
    if not _is_weekday_et(et.date()):
        return False
    t = et.time()
    return DAY_RTH_OPEN_ET <= t <= DAY_RTH_LAST_ENTRY_ET


def parse_et_hhmm(value: str | None, fallback: time) -> time:
    """Parse an ``"HH:MM"`` ET clock string; return ``fallback`` on any bad input."""
    if not value:
        return fallback
    try:
        hh, mm = str(value).strip().split(":")
        return time(int(hh), int(mm))
    except (ValueError, TypeError):
        return fallback


def is_day_ledger_dead_zone_et(
    ref_utc: datetime,
    *,
    start_et: time | None = None,
    end_et: time | None = None,
) -> bool:
    """True when ``ref_utc`` falls in the configured midday low-quality window ``[start, end)``.

    Half-open by design so the boundary minute (default 14:00) re-qualifies into the
    healthier afternoon window. Weekends never match (no entries anyway).
    """
    et = now_et(ref_utc)
    if not _is_weekday_et(et.date()):
        return False
    start = start_et or DAY_DEADZONE_START_ET
    end = end_et or DAY_DEADZONE_END_ET
    if start >= end:
        return False
    return start <= et.time() < end


def is_swing_monitor_evaluation_window_et(ref_utc: datetime) -> bool:
    """Evaluate swing holds once after each session close (weekday, at/after close capture)."""
    et = now_et(ref_utc)
    if not _is_weekday_et(et.date()):
        return False
    t = et.time()
    return t >= time(16, 0)


def is_day_monitor_active_session_et(ref_utc: datetime) -> bool:
    """Day intraday monitor runs during RTH (same window as entries, through close)."""
    et = now_et(ref_utc)
    if not _is_weekday_et(et.date()):
        return False
    t = et.time()
    return DAY_RTH_OPEN_ET <= t <= time(16, 0)


def is_at_or_after_day_flatten_cutoff_et(ref_utc: datetime) -> bool:
    et = now_et(ref_utc)
    if not _is_weekday_et(et.date()):
        return False
    return et.time() >= DAY_FLATTEN_CUTOFF_ET
