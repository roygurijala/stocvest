"""Track execution-actionable transitions (platform scope) and fan out alert emails."""

from __future__ import annotations

from typing import Any, Literal

from stocvest.api.services.execution_actionable import (
    apply_entry_gates_to_response_body,
    scenario_payload_from_body,
)
from stocvest.utils.config import get_settings
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

Mode = Literal["day", "swing"]

_STATE_PREFIX = "stocvest:execution_actionable:"
_LEDGER_STATE_PREFIX = "stocvest:ledger_qualified:"
_CURSOR_PREFIX = "stocvest:retained_pool_track_cursor:"


def _redis():
    import redis

    return redis.Redis.from_url(str(get_settings().redis_url), decode_responses=True)


def _state_key(mode: Mode, symbol: str) -> str:
    return f"{_STATE_PREFIX}{mode}:{symbol.strip().upper()}"


def _ledger_state_key(mode: Mode, symbol: str) -> str:
    return f"{_LEDGER_STATE_PREFIX}{mode}:{symbol.strip().upper()}"


def _cursor_key(mode: Mode) -> str:
    return f"{_CURSOR_PREFIX}{mode}"


def read_execution_actionable_state(mode: Mode, symbol: str) -> bool | None:
    if get_settings().stocvest_disable_redis:
        return None
    try:
        raw = _redis().get(_state_key(mode, symbol))
        if raw is None:
            return None
        return str(raw).lower() in ("1", "true", "yes")
    except Exception:
        return None


def write_execution_actionable_state(mode: Mode, symbol: str, value: bool) -> None:
    if get_settings().stocvest_disable_redis:
        return
    try:
        _redis().setex(_state_key(mode, symbol), 86400 * 3, "1" if value else "0")
    except Exception as exc:
        _LOG.debug("execution_actionable state write failed %s %s: %s", mode, symbol, exc)


def read_ledger_qualified_state(mode: Mode, symbol: str) -> bool | None:
    if get_settings().stocvest_disable_redis:
        return None
    try:
        raw = _redis().get(_ledger_state_key(mode, symbol))
        if raw is None:
            return None
        return str(raw).lower() in ("1", "true", "yes")
    except Exception:
        return None


def write_ledger_qualified_state(mode: Mode, symbol: str, value: bool) -> None:
    if get_settings().stocvest_disable_redis:
        return
    try:
        _redis().setex(_ledger_state_key(mode, symbol), 86400 * 3, "1" if value else "0")
    except Exception as exc:
        _LOG.debug("ledger_qualified state write failed %s %s: %s", mode, symbol, exc)


def _notify_tradable_desk_transition(
    sym: str,
    mode: Mode,
    body: dict[str, Any],
    *,
    ledger_qualified_only: bool,
) -> None:
    from stocvest.api.services.execution_actionable_notify import notify_execution_actionable_transition

    scenario = scenario_payload_from_body(body, mode=mode, symbol=sym)
    if ledger_qualified_only:
        scenario["ledger_qualified_only"] = True
    notify_execution_actionable_transition(sym, mode, scenario)


def process_composite_body(
    body: dict[str, Any],
    *,
    mode: Mode,
    symbol: str,
    notify: bool = True,
) -> dict[str, Any]:
    """
    Apply entry gates, detect tradable desk transitions, optionally email users.

    Emails on false→true for ``execution_actionable`` (preferred) or ``ledger_qualified``
    when execution is not yet true. Desk batch fan-out is platform-wide (not watchlist scoped).

    Returns summary dict with transition flags and current gate state.
    """
    sym = symbol.strip().upper()
    apply_entry_gates_to_response_body(body, mode=mode)
    execution_ok = bool(body.get("execution_actionable"))
    ledger_ok = bool(body.get("ledger_qualified"))
    prev_execution = read_execution_actionable_state(mode, sym)
    prev_ledger = read_ledger_qualified_state(mode, sym)
    write_execution_actionable_state(mode, sym, execution_ok)
    write_ledger_qualified_state(mode, sym, ledger_ok)
    execution_transitioned = execution_ok and prev_execution is not True
    ledger_transitioned = ledger_ok and prev_ledger is not True
    if notify:
        try:
            if execution_transitioned:
                _notify_tradable_desk_transition(sym, mode, body, ledger_qualified_only=False)
            elif ledger_transitioned:
                _notify_tradable_desk_transition(sym, mode, body, ledger_qualified_only=True)
        except Exception as exc:  # noqa: BLE001
            _LOG.warning("tradable desk notify failed %s %s: %s", mode, sym, exc)
    return {
        "symbol": sym,
        "mode": mode,
        "execution_actionable": execution_ok,
        "ledger_qualified": ledger_ok,
        "transitioned": execution_transitioned or ledger_transitioned,
        "execution_transitioned": execution_transitioned,
        "ledger_transitioned": ledger_transitioned,
        "decision_state": body.get("decision_state"),
    }


def retained_pool_track_cursor(mode: Mode) -> int:
    if get_settings().stocvest_disable_redis:
        return 0
    try:
        raw = _redis().get(_cursor_key(mode))
        return int(raw) if raw is not None else 0
    except Exception:
        return 0


def advance_retained_pool_cursor(mode: Mode, *, pool_size: int, batch_size: int) -> int:
    """Round-robin start index for retained-pool composite tracking."""
    if pool_size <= 0:
        return 0
    start = retained_pool_track_cursor(mode) % pool_size
    nxt = (start + max(0, batch_size)) % pool_size
    if get_settings().stocvest_disable_redis:
        return start
    try:
        _redis().setex(_cursor_key(mode), 86400 * 7, str(nxt))
    except Exception:
        pass
    return start
