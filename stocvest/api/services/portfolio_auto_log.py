"""Background hook: log eligible bullish composite outcomes to the model portfolio."""

from __future__ import annotations

from typing import Any

from stocvest.api.services.alert_tasks import run_alert_background
from stocvest.api.services.portfolio_entry_reason import build_entry_reason_from_layer_results
from stocvest.api.services.portfolio_recorder import get_portfolio_recorder
from stocvest.signals.composite_score import CompositeVerdict
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)


def schedule_model_portfolio_log_from_composite(
    *,
    symbol: str,
    composite_verdict: CompositeVerdict,
    composite_score: int,
    entry_price: float,
    layer_results: list[Any],
    macro_regime: str,
    confluence_fired: bool,
    confluence_score: int,
    vix_at_entry: float | None,
    spy_day_pct: float | None,
    sector_etf: str | None,
    sector_day_pct: float | None,
    parameter_version: str,
) -> None:
    """Fire-and-forget: open a notional tracked position when gates pass (never blocks HTTP)."""
    sym = symbol.strip().upper()
    if composite_verdict != CompositeVerdict.BULLISH:
        return
    if int(composite_score) < 72:
        _LOG.info(
            "Portfolio: skipped symbol=%s score=%s reason=below_threshold threshold=72",
            sym,
            int(composite_score),
        )
        return
    if (macro_regime or "").strip().lower() == "avoid":
        _LOG.info("Portfolio: skipped symbol=%s reason=avoid_regime", sym)
        return

    layer_ids = ["technical", "news", "macro", "sector", "geopolitical", "internals"]
    layer_scores: dict[str, Any] = {}
    layer_verdicts: dict[str, Any] = {}
    layer_chips: dict[str, Any] = {}
    for lid, res in zip(layer_ids, layer_results):
        sc = getattr(res, "score", None)
        if sc is not None:
            layer_scores[lid] = sc
        layer_verdicts[lid] = getattr(res, "verdict", "neutral")
        layer_chips[lid] = list(getattr(res, "chips", []) or [])

    entry_reason = build_entry_reason_from_layer_results(layer_results)

    def _run() -> None:
        try:
            rec = get_portfolio_recorder()
            rec.open_position(
                symbol=sym,
                entry_price=float(entry_price),
                signal_score=int(composite_score),
                entry_reason=entry_reason,
                layer_scores=layer_scores,
                layer_verdicts=layer_verdicts,
                layer_chips=layer_chips,
                confluence_fired=bool(confluence_fired),
                confluence_score=int(confluence_score),
                market_regime=str(macro_regime or "neutral"),
                vix_at_entry=vix_at_entry,
                spy_day_pct=spy_day_pct,
                sector_etf=sector_etf,
                sector_day_pct=sector_day_pct,
                parameter_version=str(parameter_version or "1.0.0"),
            )
        except Exception:
            _LOG.exception("model portfolio auto-log failed for %s", sym)

    run_alert_background(_run)
