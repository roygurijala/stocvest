"""One-shot cash correction for buys that were recorded before debit-on-buy shipped."""

from __future__ import annotations

from stocvest.api.services.holdings_store import get_holdings_store
from stocvest.api.services.portfolio_advice_ledger import get_portfolio_advice_ledger_store
from stocvest.models.portfolio_advice_ledger import plan_undebited_buy_cash_backfill
from stocvest.models.portfolio_holding import PortfolioSettings
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)


def apply_undebited_buy_cash_backfill(user_id: str) -> PortfolioSettings:
    """Subtract undebited buy costs from cashBalance and stamp those ledger rows.

    Fail-open: a ledger/store error leaves settings unchanged so GET settings
    still returns the last saved cash.
    """
    store = get_holdings_store()
    settings = store.get_settings(user_id)
    try:
        ledger = get_portfolio_advice_ledger_store()
        new_cash, stamped = plan_undebited_buy_cash_backfill(
            ledger.list_events(user_id), settings.cash_balance
        )
        if not stamped:
            return settings
        if new_cash != settings.cash_balance:
            settings = PortfolioSettings(
                cash_balance=new_cash,
                target_position_pct=settings.target_position_pct,
                benchmark_symbol=settings.benchmark_symbol,
            )
            store.save_settings(user_id, settings)
        for event in stamped:
            ledger.put_event(event)
        return settings
    except Exception as exc:
        _LOG.warning("cash buy backfill degraded: %s", str(exc)[:200])
        return store.get_settings(user_id)
