"""Narrow composite reads for model-portfolio scheduled jobs (no HTTP side effects)."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any

from stocvest.api.services.real_composite_engine import (
    build_real_composite_response,
    run_real_composite_engine_phase,
)
from stocvest.config.parameter_store import ParameterStore
from stocvest.config.signal_parameters import SignalParameters


@dataclass(frozen=True)
class CompositeVerdictOnly:
    """
    Composite verdict and 0–100 score for internal jobs.

    For internal assessment only —
    no recording, no logging, no alerts.
    """

    status: str  # "ok" | "insufficient_data"
    signal_summary: str
    score_0_100: int


async def get_composite_verdict_only(*, symbol: str, params: SignalParameters) -> CompositeVerdictOnly:
    """
    Run the same six-layer scoring path as real composite; return verdict and score only.

    For internal assessment only —
    no recording, no logging, no alerts.
    """
    phase = await run_real_composite_engine_phase(symbol=symbol, params=params)
    if isinstance(phase, dict):
        return CompositeVerdictOnly(status="insufficient_data", signal_summary="", score_0_100=0)
    sc = float(phase.composite.score)
    score_0_100 = int(round((sc + 1.0) * 50.0))
    score_0_100 = max(0, min(100, score_0_100))
    return CompositeVerdictOnly(
        status="ok",
        signal_summary=str(phase.composite.verdict.value),
        score_0_100=score_0_100,
    )


def run_portfolio_scanner_for_symbol(symbol: str) -> dict[str, Any]:
    """
    Internal/system path: run real composite with model-portfolio auto-log enabled.

    Only ``build_real_composite_response`` (intraday / day layers) feeds the model
    portfolio. Swing composite has its own track record (future — see BACKLOG
    B-swing-portfolio) and must never call this path.

    HTTP handlers must not call this; they use ``enable_portfolio_log=False``.
    """
    params = ParameterStore.get_parameters_sync()
    return asyncio.run(
        build_real_composite_response(
            symbol=symbol,
            user_id=None,
            user_email=None,
            params=params,
            enable_portfolio_log=True,
        )
    )
