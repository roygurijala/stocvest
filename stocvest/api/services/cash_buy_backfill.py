"""Rebuild leftover cash from the advice-ledger tape.

Seeded lots are already owned. Cash is sale proceeds minus later Pay-from-cash
buys. The 2026-10-30 GET path first subtracted every unstamped buy, then restored
the sum of those stamps — that stamp-sum is not leftover dry powder.
"""

from __future__ import annotations

from stocvest.api.services.holdings_store import get_holdings_store
from stocvest.api.services.portfolio_advice_ledger import get_portfolio_advice_ledger_store
from stocvest.models.portfolio_advice_ledger import (
    buy_cash_debit_refund,
    live_cash_buy_spend,
    reconstruct_book_cash,
)
from stocvest.models.portfolio_holding import PortfolioSettings
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)


def apply_undebited_buy_cash_backfill(user_id: str) -> PortfolioSettings:
    """Replace the stamp-sum restore with tape leftover. Fail-open."""
    store = get_holdings_store()
    settings = store.get_settings(user_id)
    if settings.cash_tape_rebuilt:
        return settings
    try:
        events = get_portfolio_advice_ledger_store().list_events(user_id)
        tape = reconstruct_book_cash(events)
        stamps = buy_cash_debit_refund(events)
        live = live_cash_buy_spend(events)
        cash = settings.cash_balance
        # Stamp-sum restore: cash was set to every buy cashDebited, including seed lots.
        if stamps > 0 and abs(cash - stamps) <= 0.009:
            cash = tape if tape > 0 else round(max(0.0, stamps - live), 2)
        elif tape > 0 and cash <= 0:
            cash = tape
        settings = PortfolioSettings(
            cash_balance=cash,
            target_position_pct=settings.target_position_pct,
            benchmark_symbol=settings.benchmark_symbol,
            cash_backfill_reverted=True,
            cash_tape_rebuilt=True,
        )
        store.save_settings(user_id, settings)
        return settings
    except Exception as exc:
        _LOG.warning("cash tape rebuild degraded: %s", str(exc)[:200])
        return store.get_settings(user_id)
