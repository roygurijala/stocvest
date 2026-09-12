"""User-declared portfolio holdings — per-lot cost basis (manual, non-broker).

STOCVEST-manages-my-portfolio feature. A holding is one symbol the user owns; each
**lot** is a single purchase (quantity + cost basis per share + purchase date), so the
system can reason at lot granularity (trim the losing lot, tax holding-period per lot).

This is distinct from the paused broker-portfolio surface (`api/handlers/portfolio.py`,
which reads live positions from a broker adapter) — these are manually-entered holdings
persisted per user, and are the source of truth for the daily portfolio review.

Personal-tool framing: the derived guidance elsewhere (Hold / Trim / Sell / Buy-more) is
for the single operator only; this module is pure data (no advice, no network).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any

MAX_HOLDINGS_PER_USER = 100
MAX_LOTS_PER_SYMBOL = 50


def _to_decimals(value: Any) -> Any:
    """boto3 rejects Python ``float`` on ``put_item`` — recurse to ``Decimal``."""
    if isinstance(value, bool):
        return value
    if isinstance(value, float):
        return Decimal(str(value))
    if isinstance(value, dict):
        return {k: _to_decimals(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_to_decimals(v) for v in value]
    return value


def _coerce_iso_date(raw: Any) -> str:
    """Normalize a purchase date to an ISO ``YYYY-MM-DD`` string; raise on garbage."""
    if isinstance(raw, (datetime, date)):
        d = raw.date() if isinstance(raw, datetime) else raw
        return d.isoformat()
    s = str(raw or "").strip()
    if not s:
        raise ValueError("purchaseDate is required.")
    # Accept full ISO datetimes too (take the date part).
    s = s.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(s).date().isoformat()
    except ValueError:
        # Bare date already?
        return date.fromisoformat(s[:10]).isoformat()


@dataclass(frozen=True)
class HoldingLot:
    """A single purchase of a symbol."""

    lot_id: str
    quantity: float
    cost_basis: float  # price paid per share
    purchase_date: str  # ISO YYYY-MM-DD
    note: str | None = None

    @property
    def total_cost(self) -> float:
        return round(self.quantity * self.cost_basis, 4)

    def holding_period_days(self, *, as_of: date | None = None) -> int:
        ref = as_of or datetime.now(timezone.utc).date()
        return max(0, (ref - date.fromisoformat(self.purchase_date)).days)

    def is_long_term(self, *, as_of: date | None = None) -> bool:
        """US long-term capital-gains holding period is > 1 year (365 days)."""
        return self.holding_period_days(as_of=as_of) > 365

    def to_api(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "lotId": self.lot_id,
            "quantity": self.quantity,
            "costBasis": self.cost_basis,
            "purchaseDate": self.purchase_date,
        }
        if self.note:
            out["note"] = self.note
        return out

    @classmethod
    def from_api(cls, raw: dict[str, Any]) -> HoldingLot:
        qty = float(raw["quantity"])
        cost = float(raw["costBasis"])
        if qty <= 0:
            raise ValueError("quantity must be > 0.")
        if cost < 0:
            raise ValueError("costBasis must be >= 0.")
        lot_id = str(raw.get("lotId") or "").strip()
        if not lot_id:
            raise ValueError("lotId is required.")
        note_raw = raw.get("note")
        return cls(
            lot_id=lot_id,
            quantity=qty,
            cost_basis=cost,
            purchase_date=_coerce_iso_date(raw.get("purchaseDate")),
            note=(str(note_raw).strip() or None) if note_raw else None,
        )


@dataclass(frozen=True)
class PortfolioHolding:
    """All lots of one symbol the user owns."""

    symbol: str
    lots: tuple[HoldingLot, ...] = field(default_factory=tuple)

    @property
    def total_quantity(self) -> float:
        return round(sum(lot.quantity for lot in self.lots), 6)

    @property
    def total_cost(self) -> float:
        return round(sum(lot.total_cost for lot in self.lots), 4)

    @property
    def average_cost(self) -> float | None:
        qty = self.total_quantity
        if qty <= 0:
            return None
        return round(self.total_cost / qty, 4)

    def earliest_purchase_date(self) -> str | None:
        if not self.lots:
            return None
        return min(lot.purchase_date for lot in self.lots)

    def to_api(self) -> dict[str, Any]:
        return {
            "symbol": self.symbol,
            "totalQuantity": self.total_quantity,
            "averageCost": self.average_cost,
            "totalCost": self.total_cost,
            "lots": [lot.to_api() for lot in self.lots],
        }

    def to_dynamo_item(self) -> dict[str, Any]:
        # Persist only the durable fields (symbol + lots); derived values recomputed on read.
        return _to_decimals(
            {"symbol": self.symbol, "lots": [lot.to_api() for lot in self.lots]}
        )

    @classmethod
    def from_api(cls, raw: dict[str, Any]) -> PortfolioHolding:
        symbol = str(raw.get("symbol") or "").strip().upper()
        if not symbol:
            raise ValueError("symbol is required.")
        lots_raw = raw.get("lots")
        if not isinstance(lots_raw, list) or not lots_raw:
            raise ValueError("at least one lot is required.")
        lots = tuple(HoldingLot.from_api(x) for x in lots_raw if isinstance(x, dict))
        if not lots:
            raise ValueError("at least one valid lot is required.")
        if len(lots) > MAX_LOTS_PER_SYMBOL:
            raise ValueError(f"a symbol may have at most {MAX_LOTS_PER_SYMBOL} lots.")
        return cls(symbol=symbol, lots=lots)

    @classmethod
    def from_dynamo_item(cls, item: dict[str, Any]) -> PortfolioHolding:
        return cls.from_api(item)
