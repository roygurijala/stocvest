"""ORB (Opening Range Breakout) daily artifact store.

ORB is computed once after the 9:30–10:00 AM ET window and stored as a market
fact for the session. Readers use DynamoDB; levels remain valid for the rest
of the trading day.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from typing import Any

from stocvest.utils.config import get_settings
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

ORB_ACCOUNT_PREFIX = "ORB#"


@dataclass
class ORBRecord:
    trade_date: str
    symbol: str
    orb_high: float
    orb_low: float
    orb_range_pct: float
    computed_at: str
    status: str = "complete"

    @property
    def midpoint(self) -> float:
        return (self.orb_high + self.orb_low) / 2


def _ddb_table() -> Any:
    import boto3

    settings = get_settings()
    kwargs: dict[str, Any] = {"region_name": settings.aws_region}
    if settings.dynamodb_endpoint_url:
        kwargs["endpoint_url"] = settings.dynamodb_endpoint_url
    db = boto3.resource("dynamodb", **kwargs)
    name = settings.dynamodb_day_trading_setups.strip()
    if not name:
        raise ValueError("DYNAMODB_DAY_TRADING_SETUPS is not configured")
    return db.Table(name)


def store_orb_record(
    symbol: str,
    orb_high: float,
    orb_low: float,
    trade_date: date | None = None,
) -> ORBRecord:
    """Persist ORB levels for ``symbol`` on ``trade_date`` (today if omitted)."""
    td = trade_date or date.today()
    td_str = td.isoformat()
    sym_u = symbol.upper()
    computed_at = datetime.now().strftime("%H:%M:%S ET")
    range_pct = (orb_high - orb_low) / orb_low * 100 if orb_low > 0 else 0.0
    record = ORBRecord(
        trade_date=td_str,
        symbol=sym_u,
        orb_high=round(orb_high, 4),
        orb_low=round(orb_low, 4),
        orb_range_pct=round(range_pct, 2),
        computed_at=computed_at,
        status="complete",
    )
    table = _ddb_table()
    table.put_item(
        Item={
            "accountId": f"{ORB_ACCOUNT_PREFIX}{sym_u}",
            "setupKey": td_str,
            "scanType": "orb_daily",
            "orb_high": str(record.orb_high),
            "orb_low": str(record.orb_low),
            "orb_range_pct": str(record.orb_range_pct),
            "computed_at": computed_at,
            "status": "complete",
        }
    )
    return record


def get_orb_record(symbol: str, trade_date: date | None = None) -> ORBRecord | None:
    """Load today's ORB row for ``symbol``. Returns ``None`` if missing or on error."""
    td = trade_date or date.today()
    td_str = td.isoformat()
    sym_u = symbol.upper()
    try:
        table = _ddb_table()
        response = table.get_item(
            Key={
                "accountId": f"{ORB_ACCOUNT_PREFIX}{sym_u}",
                "setupKey": td_str,
            }
        )
        item = response.get("Item")
        if not item:
            return None
        return ORBRecord(
            trade_date=td_str,
            symbol=sym_u,
            orb_high=float(item["orb_high"]),
            orb_low=float(item["orb_low"]),
            orb_range_pct=float(item["orb_range_pct"]),
            computed_at=str(item["computed_at"]),
            status=str(item.get("status") or "complete"),
        )
    except Exception as exc:
        _LOG.warning("orb_record_read_failed symbol=%s error=%s", sym_u, exc)
        return None
