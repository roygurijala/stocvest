"""Weekly Position validation ledger capture (ADR-004 POS-D9).

Sweeps the POS-D15 position universe in the Friday post-close window, runs the position
composite for each name, and writes qualified/shadow ledger rows (``mode="position"``) under
the synthetic platform capture user (``settings.stocvest_position_ledger_user``), mirrored to
PUBLIC for the report/backtest. Entry gates are the grounded ``evaluate_position_desk_entry``
(via :func:`maybe_persist_position_ledger_row`); during the VAL-POS soak most rows are shadow.
Alerts stay disabled until soak sign-off (POS-D10).
"""

from __future__ import annotations

import asyncio
from typing import Any, Awaitable, Callable

from stocvest.api.services.ledger_study_capture import maybe_persist_position_ledger_row
from stocvest.api.services.position_composite_engine import build_position_composite_response
from stocvest.api.services.position_scan import POSITION_SCAN_UNIVERSE_V1
from stocvest.config.parameter_store import ParameterStore
from stocvest.signals.composite_score import CompositeVerdict
from stocvest.utils.config import get_settings
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

_DEFAULT_CONCURRENCY = 4
_ComposeFn = Callable[[str], Awaitable[dict[str, Any]]]


def _f(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _layer_scores(body: dict[str, Any]) -> dict[str, float]:
    out: dict[str, float] = {}
    for row in body.get("layers") or []:
        if not isinstance(row, dict):
            continue
        lid = str(row.get("layer") or "").strip().lower()
        sc = row.get("score")
        if lid and isinstance(sc, (int, float)):
            out[lid] = float(sc)
    return out


def _regime_label(body: dict[str, Any]) -> str:
    # market_environment (build_market_environment_from_macro) exposes the coarse macro
    # regime under "macro_regime"; the composite body may also carry a top-level "regime".
    env = body.get("market_environment")
    if isinstance(env, dict):
        for key in ("macro_regime", "regime_label", "regime", "market_regime"):
            val = env.get(key)
            if val:
                return str(val).strip().lower()
    for key in ("regime", "market_regime"):
        val = body.get(key)
        if val:
            return str(val).strip().lower()
    return "neutral"


def _signal_strength(body: dict[str, Any]) -> int:
    try:
        n = int(round(abs(float(body.get("composite_score")))))  # type: ignore[arg-type]
    except (TypeError, ValueError):
        n = 0
    return max(0, min(100, n))


def _persist_body(body: dict[str, Any], *, user_id: str, params: Any) -> tuple[str, bool] | None:
    """Map a position composite body onto a ledger row; returns (symbol, eligible) or None."""
    sym = str(body.get("symbol") or "").strip().upper()
    if not sym:
        return None
    status = str(body.get("status") or "active").strip().lower()
    if status == "insufficient_data":
        return None
    verdict_raw = str(body.get("verdict") or "neutral").strip().lower()
    try:
        verdict = CompositeVerdict(verdict_raw)
    except ValueError:
        verdict = CompositeVerdict.NEUTRAL
    env = body.get("market_environment")
    eligible, _gates = maybe_persist_position_ledger_row(
        ledger_capture=True,
        user_id=user_id,
        symbol=sym,
        response_status=status if status in ("active", "incomplete") else "active",
        verdict=verdict,
        risk_reward=_f(body.get("risk_reward")),
        price_at_signal=_f(body.get("last_trade_price")),
        layer_scores=_layer_scores(body),
        signal_strength=_signal_strength(body),
        pattern="position_composite",
        params=params,
        snapshot_blobs={},
        layer_scores_json=None,
        stop_level=_f(body.get("reference_stop_level")),
        reference_structure_level=_f(body.get("reference_target_1")),
        regime_label=_regime_label(body),
        sector_label=str(body.get("sector") or ""),
        market_environment=env if isinstance(env, dict) else None,
    )
    return sym, bool(eligible)


async def run_position_ledger_capture_async(
    *,
    universe: tuple[str, ...] | list[str] | None = None,
    compose: _ComposeFn | None = None,
    concurrency: int = _DEFAULT_CONCURRENCY,
) -> dict[str, Any]:
    settings = get_settings()
    user_id = (settings.stocvest_position_ledger_user or "platform-position-ledger").strip()
    params = ParameterStore.get_parameters_sync()
    symbols = list(universe) if universe is not None else list(POSITION_SCAN_UNIVERSE_V1)

    async def _default_compose(sym: str) -> dict[str, Any]:
        return await build_position_composite_response(
            symbol=sym, user_id=None, user_email=None, params=params
        )

    composer = compose or _default_compose
    sem = asyncio.Semaphore(max(1, concurrency))
    stats = {"evaluated": 0, "qualified": 0, "shadow": 0, "errors": 0}

    async def _one(sym: str) -> None:
        async with sem:
            try:
                body = await composer(sym)
            except Exception as exc:  # one bad symbol must not fail the sweep
                stats["errors"] += 1
                _LOG.warning("position ledger capture compose failed sym=%s: %s", sym, exc)
                return
        try:
            res = _persist_body(body, user_id=user_id, params=params)
        except Exception as exc:
            stats["errors"] += 1
            _LOG.warning("position ledger capture persist failed sym=%s: %s", sym, exc)
            return
        if res is None:
            return
        stats["evaluated"] += 1
        if res[1]:
            stats["qualified"] += 1
        else:
            stats["shadow"] += 1

    await asyncio.gather(*[_one(s) for s in symbols])

    out: dict[str, Any] = {
        "job": "ledger_capture_position",
        "universe": len(symbols),
        "capture_user": user_id,
        **stats,
    }
    _LOG.info(
        "position ledger capture done universe=%s evaluated=%s qualified=%s shadow=%s errors=%s",
        len(symbols),
        stats["evaluated"],
        stats["qualified"],
        stats["shadow"],
        stats["errors"],
    )
    return out


def run_position_ledger_capture_sync(
    *,
    universe: tuple[str, ...] | list[str] | None = None,
    compose: _ComposeFn | None = None,
    concurrency: int = _DEFAULT_CONCURRENCY,
) -> dict[str, Any]:
    return asyncio.run(
        run_position_ledger_capture_async(
            universe=universe, compose=compose, concurrency=concurrency
        )
    )
