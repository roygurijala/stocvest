"""Undo the 2026-10-30 GET backfill that drained leftover dry powder to $0.

That pass treated every seeded lot as a cash spend. Cash in this book is leftover
dry powder; only later buys with Pay-from-cash should debit. Restore the leftover
once when cash is still 0, then stop.
"""

from __future__ import annotations

from stocvest.api.services.holdings_store import get_holdings_store
from stocvest.api.services.portfolio_advice_ledger import get_portfolio_advice_ledger_store
from stocvest.models.portfolio_advice_ledger import buy_cash_debit_refund
from stocvest.models.portfolio_holding import PortfolioSettings
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)


def apply_undebited_buy_cash_backfill(user_id: str) -> PortfolioSettings:
    """Restore leftover cash drained by the one-shot buy backfill. Fail-open."""
    store = get_holdings_store()
    settings = store.get_settings(user_id)
    if settings.cash_backfill_reverted:
        return settings
    try:
        refund = buy_cash_debit_refund(get_portfolio_advice_ledger_store().list_events(user_id))
        cash = settings.cash_balance
        if cash <= 0 and refund > 0:
            cash = refund
        settings = PortfolioSettings(
            cash_balance=cash,
            target_position_pct=settings.target_position_pct,
            benchmark_symbol=settings.benchmark_symbol,
            cash_backfill_reverted=True,
        )
        store.save_settings(user_id, settings)
        return settings
    except Exception as exc:
        _LOG.warning("cash buy backfill revert degraded: %s", str(exc)[:200])
        return store.get_settings(user_id)
