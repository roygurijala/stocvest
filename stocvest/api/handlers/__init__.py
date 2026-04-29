"""Lambda handlers exposed by stocvest.api.handlers."""

from stocvest.api.handlers.authorizer import handler as authorizer_handler
from stocvest.api.handlers.health import handler as health_handler
from stocvest.api.handlers.market_data import (
    bars_handler,
    market_status_handler,
    news_handler,
    snapshot_handler,
)
from stocvest.api.handlers.brokers import (
    broker_accounts_handler,
    broker_cancel_order_handler,
    broker_get_order_handler,
    broker_health_handler,
    broker_place_order_handler,
    broker_positions_handler,
)
from stocvest.api.handlers.signals import (
    day_briefing_handler,
    day_setups_handler,
    swing_composite_handler,
    swing_synthesis_parse_handler,
)
from stocvest.api.handlers.websocket import (
    websocket_connect_handler,
    websocket_default_handler,
    websocket_disconnect_handler,
)
from stocvest.api.handlers.scanner import (
    scanner_briefing_handler,
    scanner_catalysts_handler,
    scanner_gaps_handler,
    scanner_intraday_handler,
)
from stocvest.api.handlers.portfolio import (
    portfolio_allocation_handler,
    portfolio_holdings_handler,
    portfolio_summary_handler,
)

__all__ = [
    "authorizer_handler",
    "bars_handler",
    "broker_accounts_handler",
    "broker_cancel_order_handler",
    "broker_get_order_handler",
    "broker_health_handler",
    "broker_place_order_handler",
    "broker_positions_handler",
    "day_briefing_handler",
    "day_setups_handler",
    "health_handler",
    "market_status_handler",
    "news_handler",
    "portfolio_allocation_handler",
    "portfolio_holdings_handler",
    "portfolio_summary_handler",
    "scanner_briefing_handler",
    "scanner_catalysts_handler",
    "scanner_gaps_handler",
    "scanner_intraday_handler",
    "snapshot_handler",
    "swing_composite_handler",
    "swing_synthesis_parse_handler",
    "websocket_connect_handler",
    "websocket_default_handler",
    "websocket_disconnect_handler",
]

