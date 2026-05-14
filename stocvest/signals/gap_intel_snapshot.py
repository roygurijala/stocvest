"""Server-computed Gap Intelligence snapshot (single lifecycle view per symbol × session).

Deterministic phase classification (US/Eastern), liquidity gate, fill-level resolution,
gap status vs prior close / session open, and Scenario Builder availability (structural).

**Persistence:** optional read-through cache in DynamoDB (``GapIntelCache`` / env
``DYNAMODB_GAP_INTEL_CACHE_TABLE``) keyed by symbol × trading_mode × ET session date,
with a soft TTL (~120s) before recomputation. An EventBridge ``rate(2 minutes)`` rule
invokes the ``signals`` Lambda with ``gap_intel_cache_tick`` to warm anchor symbols
(``GAP_INTEL_TICK_SYMBOLS``). Scenario Builder transitions into ``DISABLED`` emit a
debounced ``Stocvest/GapIntel`` → ``ScenarioBuilderDisabled`` CloudWatch metric (1/hour
per symbol × mode).
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from enum import Enum
from typing import Any, Literal
from zoneinfo import ZoneInfo

from stocvest.data.models import Bar, MarketStatus, Snapshot

_ET = ZoneInfo("America/New_York")

# Tunables (product defaults; may move to SignalParameters later)
MIN_GAP_PCT = 0.005  # 0.50%
HOLDING_BUFFER = 0.001  # 0.10%
ACCEPTANCE_MINUTES = 30
ADV_SHARES_MIN = 5_000_000
PRIOR_DOLLAR_VOL_MIN = 200_000_000
SPREAD_MAX_PCT = 0.002  # 0.20%


class PhaseState(str, Enum):
    MARKET_CLOSED = "MARKET_CLOSED"
    OFF_PRE = "OFF_PRE"
    PRE_MARKET = "PRE_MARKET"
    SESSION_OPEN = "SESSION_OPEN"
    SESSION = "SESSION"
    AFTER_HOURS = "AFTER_HOURS"
    OFF_POST = "OFF_POST"


class GapDirection(str, Enum):
    UP = "UP"
    DOWN = "DOWN"
    NONE = "NONE"
    UNKNOWN = "UNKNOWN"


class GapStatus(str, Enum):
    NONE = "NONE"
    FORMING = "FORMING"
    HOLDING = "HOLDING"
    FILLING = "FILLING"
    FILLED = "FILLED"
    ACCEPTING = "ACCEPTING"
    REVERTING = "REVERTING"
    SETUP = "SETUP"
    UNKNOWN = "UNKNOWN"


class ResolutionState(str, Enum):
    PENDING = "PENDING"
    CONFIRMED = "CONFIRMED"
    INVALIDATED = "INVALIDATED"
    RESOLVED = "RESOLVED"


class FillSource(str, Enum):
    PRIOR_CLOSE = "PRIOR_CLOSE"
    PREVIOUS_SESSION_BAR = "PREVIOUS_SESSION_BAR"
    NOT_DERIVABLE = "NOT_DERIVABLE"


class FillReliability(str, Enum):
    HIGH = "HIGH"
    EMERGING = "EMERGING"
    OFF = "OFF"


class CalendarState(str, Enum):
    CONFIRMED = "CONFIRMED"
    UNCONFIRMED = "UNCONFIRMED"


class ScenarioBuilderState(str, Enum):
    DISABLED = "DISABLED"
    LIMITED = "LIMITED"
    ENABLED = "ENABLED"


def _now_et(now_utc: datetime) -> datetime:
    if now_utc.tzinfo is None:
        now_utc = now_utc.replace(tzinfo=timezone.utc)
    return now_utc.astimezone(_ET)


def _session_date_et(now_et: datetime) -> date:
    return now_et.date()


def _is_weekend_et(d: date) -> bool:
    return d.weekday() >= 5  # Sat=5 Sun=6


def _combine_et(d: date, t: time) -> datetime:
    return datetime.combine(d, t, tzinfo=_ET)


def _default_session_end_et(session_date: date) -> datetime:
    return _combine_et(session_date, time(16, 0))


def _default_ah_end_et(session_date: date, session_end: datetime) -> datetime:
    return session_end + timedelta(hours=4)


def _calendar_flags(
    session_date: date, market_status: MarketStatus | None
) -> tuple[CalendarState, datetime, datetime]:
    """Return (calendar_state, session_end_et, after_hours_end_et)."""
    session_end = _default_session_end_et(session_date)
    ah_end = _default_ah_end_et(session_date, session_end)
    if market_status is None:
        return CalendarState.UNCONFIRMED, session_end, ah_end
    # Best-effort: Polygon exchanges map rarely encodes early-close times in v1;
    # when absent we stay on standard 16:00 + 4h AH and mark unconfirmed if ambiguous.
    return CalendarState.CONFIRMED, session_end, ah_end


def _phase_for_instant(
    now_et: datetime,
    session_date: date,
    session_end: datetime,
    ah_end: datetime,
) -> tuple[PhaseState, str, str, str, int]:
    """phase_state, phase_label, window_start_et (HH:MM), window_end_et (HH:MM), cadence_seconds."""
    d = session_date

    if _is_weekend_et(d):
        return (
            PhaseState.MARKET_CLOSED,
            "MARKET CLOSED",
            "—",
            "—",
            0,
        )

    pre_start = _combine_et(d, time(7, 30))
    rth_open = _combine_et(d, time(9, 30))
    open_end = _combine_et(d, time(10, 30))

    if now_et < pre_start:
        return (
            PhaseState.OFF_PRE,
            "OFF",
            "00:00",
            "07:30",
            0,
        )
    if now_et < rth_open:
        return (
            PhaseState.PRE_MARKET,
            "GAP FORMING",
            "07:30",
            "09:30",
            300,
        )
    if now_et < open_end:
        return (
            PhaseState.SESSION_OPEN,
            "GAP HOLDING/FILLING",
            "09:30",
            "10:30",
            60,
        )
    if now_et < session_end:
        return (
            PhaseState.SESSION,
            "GAP ACCEPTANCE/REVERSION",
            "10:30",
            session_end.strftime("%H:%M"),
            900,
        )
    if now_et < ah_end:
        ah_start = session_end.strftime("%H:%M")
        ah_end_s = ah_end.strftime("%H:%M")
        return (
            PhaseState.AFTER_HOURS,
            "NEXT SESSION GAP SETUP",
            ah_start,
            ah_end_s,
            300,
        )
    return (
        PhaseState.OFF_POST,
        "OFF",
        ah_end.strftime("%H:%M"),
        "23:59",
        0,
    )


def _effective_cadence_seconds(phase: PhaseState, high_liquidity: bool) -> int:
    mapping: dict[PhaseState, int] = {
        PhaseState.MARKET_CLOSED: 0,
        PhaseState.OFF_PRE: 0,
        PhaseState.PRE_MARKET: 300,
        PhaseState.SESSION_OPEN: 60 if high_liquidity else 120,
        PhaseState.SESSION: 900,
        PhaseState.AFTER_HOURS: 300,
        PhaseState.OFF_POST: 0,
    }
    return mapping.get(phase, 0)


def _spread_pct(snapshot: Snapshot) -> float | None:
    bid = snapshot.last_quote_bid
    ask = snapshot.last_quote_ask
    if bid is None or ask is None or bid <= 0 or ask <= 0 or ask < bid:
        return None
    mid = (bid + ask) / 2.0
    if mid <= 0:
        return None
    return (ask - bid) / mid


def compute_high_liquidity(snapshot: Snapshot) -> tuple[bool, dict[str, Any]]:
    """Strict gate: ADV proxy, prior dollar volume, NBBO spread (missing → not high)."""
    prev_vol = float(snapshot.prev_day_volume or 0.0)
    prev_close = float(snapshot.prev_close or 0.0)
    adv_ok = prev_vol >= float(ADV_SHARES_MIN)
    dollar_vol = prev_close * prev_vol if prev_close > 0 and prev_vol > 0 else 0.0
    dollar_ok = dollar_vol >= float(PRIOR_DOLLAR_VOL_MIN)
    sp = _spread_pct(snapshot)
    spread_ok = sp is not None and sp <= SPREAD_MAX_PCT
    detail: dict[str, Any] = {
        "adv_proxy_shares": prev_vol,
        "adv_proxy_note": "prior_session_volume_vs_ADV_threshold",
        "prior_dollar_volume_est": dollar_vol,
        "spread_pct": sp,
    }
    return bool(adv_ok and dollar_ok and spread_ok), detail


def _resolve_fill(snapshot: Snapshot, prev_session_bar: Bar | None) -> tuple[float | None, FillSource, FillReliability]:
    pc = snapshot.prev_close
    if pc is not None and pc > 0:
        return float(pc), FillSource.PRIOR_CLOSE, FillReliability.HIGH
    if prev_session_bar is not None and prev_session_bar.close > 0:
        return float(prev_session_bar.close), FillSource.PREVIOUS_SESSION_BAR, FillReliability.EMERGING
    return None, FillSource.NOT_DERIVABLE, FillReliability.OFF


def _reference_price_for_gap(snapshot: Snapshot, phase: PhaseState, now_et: datetime) -> float | None:
    """Price vs prior for gap direction / status."""
    rth_open = _combine_et(now_et.date(), time(9, 30))
    if phase in (PhaseState.PRE_MARKET, PhaseState.OFF_PRE):
        p = snapshot.pre_market_price or snapshot.last_trade_price
        if p is not None and p > 0:
            return float(p)
        return None
    if phase in (PhaseState.SESSION_OPEN, PhaseState.SESSION):
        if now_et >= rth_open and snapshot.day_open is not None and snapshot.day_open > 0:
            return float(snapshot.day_open)
        p = snapshot.last_trade_price
        return float(p) if p is not None and p > 0 else None
    if phase == PhaseState.AFTER_HOURS:
        p = snapshot.after_hours_price or snapshot.last_trade_price
        return float(p) if p is not None and p > 0 else None
    p = snapshot.last_trade_price
    return float(p) if p is not None and p > 0 else None


def _gap_direction_pct(ref: float | None, prev_close: float | None) -> tuple[GapDirection, float | None]:
    if ref is None or prev_close is None or prev_close <= 0:
        return GapDirection.UNKNOWN, None
    pct = (ref - prev_close) / prev_close
    if abs(pct) < MIN_GAP_PCT:
        return GapDirection.NONE, pct
    if pct > 0:
        return GapDirection.UP, pct
    if pct < 0:
        return GapDirection.DOWN, pct
    return GapDirection.NONE, pct


def _official_gap_after_open(day_open: float | None, prev_close: float | None) -> tuple[GapDirection, float | None]:
    if day_open is None or prev_close is None or prev_close <= 0 or day_open <= 0:
        return GapDirection.UNKNOWN, None
    pct = (day_open - prev_close) / prev_close
    if abs(pct) < MIN_GAP_PCT:
        return GapDirection.NONE, pct
    if pct > 0:
        return GapDirection.UP, pct
    if pct < 0:
        return GapDirection.DOWN, pct
    return GapDirection.NONE, pct


def _bars_same_session_et(bars: list[Bar], session_date: date) -> list[Bar]:
    out: list[Bar] = []
    for b in bars:
        bt = b.timestamp
        if bt.tzinfo is None:
            bt = bt.replace(tzinfo=timezone.utc)
        if bt.astimezone(_ET).date() == session_date:
            out.append(b)
    out.sort(key=lambda x: x.timestamp)
    return out


def _holding_for_up(price: float, fill: float, buffer: float) -> bool:
    return price >= fill * (1.0 + buffer)


def _filling_for_up(price: float, fill: float, buffer: float) -> bool:
    return fill <= price < fill * (1.0 + buffer)


def _holding_for_down(price: float, fill: float, buffer: float) -> bool:
    return price <= fill * (1.0 - buffer)


def _filling_for_down(price: float, fill: float, buffer: float) -> bool:
    return fill * (1.0 - buffer) < price <= fill


def _status_from_price(
    gap_dir: GapDirection,
    price: float | None,
    fill: float | None,
    phase: PhaseState,
) -> GapStatus:
    if fill is None or fill <= 0 or price is None or price <= 0:
        return GapStatus.UNKNOWN
    buf = HOLDING_BUFFER
    if gap_dir == GapDirection.NONE:
        return GapStatus.NONE
    if gap_dir == GapDirection.UNKNOWN:
        return GapStatus.UNKNOWN

    if phase == PhaseState.PRE_MARKET:
        if gap_dir in (GapDirection.UP, GapDirection.DOWN):
            return GapStatus.FORMING
        return GapStatus.UNKNOWN

    if gap_dir == GapDirection.UP:
        if price < fill:
            return GapStatus.FILLED
        if _holding_for_up(price, fill, buf):
            return GapStatus.HOLDING
        if _filling_for_up(price, fill, buf):
            return GapStatus.FILLING
        return GapStatus.UNKNOWN
    # DOWN
    if price > fill:
        return GapStatus.FILLED
    if _holding_for_down(price, fill, buf):
        return GapStatus.HOLDING
    if _filling_for_down(price, fill, buf):
        return GapStatus.FILLING
    return GapStatus.UNKNOWN


def _refine_accepting_reverting(
    base: GapStatus,
    gap_dir: GapDirection,
    fill: float | None,
    phase: PhaseState,
    bars_et: list[Bar],
    now_et: datetime,
) -> GapStatus:
    """After 10:30 SESSION, promote HOLDING→ACCEPTING if last 30m of 1m closes stayed in HOLDING."""
    if (
        phase != PhaseState.SESSION
        or fill is None
        or gap_dir not in (GapDirection.UP, GapDirection.DOWN)
        or base not in (GapStatus.HOLDING, GapStatus.FILLING)
    ):
        return base
    open_end = _combine_et(now_et.date(), time(10, 30))
    window_start = now_et - timedelta(minutes=ACCEPTANCE_MINUTES)
    start = max(open_end, window_start)
    closes: list[tuple[datetime, float]] = []
    for b in bars_et:
        bt = b.timestamp
        if bt.tzinfo is None:
            bt = bt.replace(tzinfo=timezone.utc)
        bet = bt.astimezone(_ET)
        if bet < start or bet > now_et:
            continue
        closes.append((bet, float(b.close)))

    if len(closes) < 2:
        return base

    def in_holding(px: float) -> bool:
        if gap_dir == GapDirection.UP:
            return _holding_for_up(px, fill, HOLDING_BUFFER)
        return _holding_for_down(px, fill, HOLDING_BUFFER)

    def in_filling(px: float) -> bool:
        if gap_dir == GapDirection.UP:
            return _filling_for_up(px, fill, HOLDING_BUFFER)
        return _filling_for_down(px, fill, HOLDING_BUFFER)

    all_holding = all(in_holding(px) for _, px in closes)
    if base == GapStatus.HOLDING and all_holding and (now_et - start) >= timedelta(minutes=ACCEPTANCE_MINUTES - 1):
        return GapStatus.ACCEPTING

    if base == GapStatus.FILLING:
        # Reverting: was structurally accepting (recent window mostly holding) then filling
        recent = [px for _, px in closes[-15:]]
        if recent and in_filling(recent[-1]) and sum(1 for px in recent if in_holding(px)) >= max(1, len(recent) // 3):
            return GapStatus.REVERTING

    if base == GapStatus.HOLDING and any(in_filling(px) for _, px in closes[-5:]):
        return GapStatus.FILLING

    return base


def _resolution_state(
    phase: PhaseState,
    pre_dir: GapDirection,
    official_dir: GapDirection,
) -> ResolutionState:
    if phase in (PhaseState.PRE_MARKET, PhaseState.OFF_PRE):
        if pre_dir == GapDirection.UNKNOWN:
            return ResolutionState.PENDING
        return ResolutionState.PENDING
    if phase == PhaseState.MARKET_CLOSED:
        return ResolutionState.PENDING
    if phase in (PhaseState.SESSION_OPEN, PhaseState.SESSION, PhaseState.AFTER_HOURS, PhaseState.OFF_POST):
        if official_dir == GapDirection.UNKNOWN:
            return ResolutionState.PENDING
        if official_dir == GapDirection.NONE and pre_dir not in (GapDirection.NONE, GapDirection.UNKNOWN):
            return ResolutionState.INVALIDATED
        if official_dir == GapDirection.NONE:
            return ResolutionState.CONFIRMED
        return ResolutionState.CONFIRMED
    return ResolutionState.PENDING


def _scenario_builder(
    phase: PhaseState,
    trading_mode: Literal["day", "swing"],
    fill_source: FillSource,
    gap_dir: GapDirection,
) -> tuple[ScenarioBuilderState, list[str]]:
    reasons: list[str] = []
    if phase == PhaseState.MARKET_CLOSED:
        return ScenarioBuilderState.DISABLED, ["market_closed"]
    if phase in (PhaseState.OFF_PRE, PhaseState.OFF_POST):
        return ScenarioBuilderState.DISABLED, ["gap_intelligence_off_phase"]
    if fill_source == FillSource.NOT_DERIVABLE:
        return ScenarioBuilderState.DISABLED, ["fill_level_not_derivable"]

    if phase == PhaseState.PRE_MARKET:
        if trading_mode == "day":
            return ScenarioBuilderState.DISABLED, ["day_planning_requires_rth_structure"]
        return ScenarioBuilderState.LIMITED, ["swing_premarket_planning_only"]

    if phase == PhaseState.SESSION_OPEN:
        if trading_mode == "day":
            return ScenarioBuilderState.LIMITED, ["day_open_phase_volatility"]
        return ScenarioBuilderState.ENABLED, []

    if phase == PhaseState.SESSION:
        st = ScenarioBuilderState.ENABLED
        if gap_dir == GapDirection.UNKNOWN:
            st = ScenarioBuilderState.DISABLED
            reasons.append("gap_direction_unknown")
        return st, reasons

    if phase == PhaseState.AFTER_HOURS:
        if trading_mode == "day":
            return ScenarioBuilderState.DISABLED, ["day_after_hours_no_rth_context"]
        return ScenarioBuilderState.LIMITED, ["swing_after_hours_next_session_only"]

    return ScenarioBuilderState.DISABLED, ["unknown_phase"]


def build_gap_intel_snapshot(
    *,
    symbol: str,
    snapshot: Snapshot,
    bars_1m: list[Bar],
    market_status: MarketStatus | None,
    trading_mode: Literal["day", "swing"],
    now_utc: datetime,
    prev_session_bar: Bar | None,
) -> dict[str, Any]:
    """Assemble the HTTP payload for ``GET /v1/signals/gap-intel``."""
    sym = symbol.strip().upper()
    now_et = _now_et(now_utc)
    session_date = _session_date_et(now_et)
    cal_state, session_end, ah_end = _calendar_flags(session_date, market_status)
    phase, label, w_start, w_end, cadence = _phase_for_instant(now_et, session_date, session_end, ah_end)

    market_closed = phase == PhaseState.MARKET_CLOSED
    high_liq, liq_detail = compute_high_liquidity(snapshot)
    cadence = _effective_cadence_seconds(phase, high_liq)

    fill, fill_src, fill_rel = _resolve_fill(snapshot, prev_session_bar)
    ref_pre = _reference_price_for_gap(snapshot, PhaseState.PRE_MARKET, now_et)
    pre_dir, pre_pct = _gap_direction_pct(ref_pre, snapshot.prev_close)

    day_open = float(snapshot.day_open) if snapshot.day_open is not None and snapshot.day_open > 0 else None
    pc = float(snapshot.prev_close) if snapshot.prev_close is not None and snapshot.prev_close > 0 else None
    official_dir, official_pct = _official_gap_after_open(day_open, pc)

    if phase in (PhaseState.PRE_MARKET, PhaseState.OFF_PRE):
        gap_dir = pre_dir
        gap_pct = pre_pct
    elif phase in (
        PhaseState.SESSION_OPEN,
        PhaseState.SESSION,
        PhaseState.AFTER_HOURS,
        PhaseState.OFF_POST,
    ):
        gap_dir = official_dir if official_dir != GapDirection.UNKNOWN else pre_dir
        gap_pct = official_pct if official_pct is not None else pre_pct
    else:
        gap_dir, gap_pct = GapDirection.UNKNOWN, None

    price = _reference_price_for_gap(snapshot, phase, now_et)
    status = _status_from_price(gap_dir, price, fill, phase)
    if phase == PhaseState.AFTER_HOURS and status not in (GapStatus.UNKNOWN, GapStatus.NONE, GapStatus.FILLED):
        status = GapStatus.SETUP
    bars_day = _bars_same_session_et(bars_1m, session_date)
    status = _refine_accepting_reverting(status, gap_dir, fill, phase, bars_day, now_et)

    res = _resolution_state(phase, pre_dir, official_dir)

    sb_state, sb_reasons = _scenario_builder(phase, trading_mode, fill_src, gap_dir)

    return {
        "symbol": sym,
        "session_date": session_date.isoformat(),
        "computed_at_utc": now_utc.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "phase": {
            "state": phase.value,
            "label": label,
            "window_start_et": w_start,
            "window_end_et": w_end,
            "cadence_seconds": cadence,
        },
        "gap": {
            "direction": gap_dir.value,
            "status": status.value,
            "resolution_state": res.value,
            "gap_size_pct": round(gap_pct * 100, 4) if gap_pct is not None else None,
        },
        "levels": {
            "fill_level": fill,
            "fill_source": fill_src.value,
            "fill_reliability": fill_rel.value,
        },
        "liquidity": {"is_high_liquidity": high_liq, "detail": liq_detail},
        "scenario_builder": {"state": sb_state.value, "reasons": sb_reasons},
        "flags": {
            "calendar_state": cal_state.value,
            "stale": False,
            "market_closed": market_closed,
        },
    }


def gap_intel_assistant_block(snapshot: dict[str, Any]) -> dict[str, Any]:
    """Subset safe to embed in assistant ``page_context`` (server may re-emit this dict)."""
    phase = snapshot.get("phase") or {}
    gap = snapshot.get("gap") or {}
    levels = snapshot.get("levels") or {}
    liq = snapshot.get("liquidity") or {}
    sb = snapshot.get("scenario_builder") or {}
    flags = snapshot.get("flags") or {}
    return {
        "phase": {"state": phase.get("state"), "label": phase.get("label")},
        "gap": {
            "direction": gap.get("direction"),
            "status": gap.get("status"),
            "resolution_state": gap.get("resolution_state"),
        },
        "levels": {
            "fill_level": levels.get("fill_level"),
            "fill_source": levels.get("fill_source"),
            "fill_reliability": levels.get("fill_reliability"),
        },
        "liquidity": {"is_high_liquidity": liq.get("is_high_liquidity")},
        "scenario_builder": {"state": sb.get("state"), "reasons": list(sb.get("reasons") or [])},
        "flags": {
            "calendar_state": flags.get("calendar_state"),
            "stale": bool(flags.get("stale")),
        },
    }
