"""Fundamentals provider abstraction for Position desk (ADR-004 POS-D1).

FMP is the v1 primary backend. All methods never raise — callers get empty lists on
missing API keys, network failures, or malformed payloads.
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass, field
from typing import Any, Callable, Protocol, TypeVar, cast, runtime_checkable

import httpx

from stocvest.data.fmp_client import FMP_STABLE_BASE
from stocvest.data.fundamentals_models import (
    BalanceSheet,
    CashFlowStatement,
    FinancialRatios,
    FundamentalsPeriod,
    IncomeStatement,
    KeyMetrics,
    PositionFundamentalsSnapshot,
    assess_snapshot_data_quality,
    clamp_fundamentals_limit,
    normalize_fundamentals_symbol,
)
from stocvest.utils.config import get_settings
from stocvest.utils.logging import get_logger
from stocvest.utils.redis_client import get_sync_redis

_LOG = get_logger(__name__)

_CACHE_TTL_SEC = 24 * 60 * 60
_MIN_LIMIT = 1
_MAX_LIMIT = 40
_DEFAULT_LIMIT = 12
_MAX_PEER_LIMIT = 25

TModel = TypeVar("TModel")


@runtime_checkable
class FundamentalsProvider(Protocol):
    async def get_income_statements(
        self,
        symbol: str,
        *,
        period: FundamentalsPeriod = "quarter",
        limit: int = _DEFAULT_LIMIT,
    ) -> list[IncomeStatement]: ...

    async def get_balance_sheets(
        self,
        symbol: str,
        *,
        period: FundamentalsPeriod = "quarter",
        limit: int = _DEFAULT_LIMIT,
    ) -> list[BalanceSheet]: ...

    async def get_cash_flows(
        self,
        symbol: str,
        *,
        period: FundamentalsPeriod = "quarter",
        limit: int = _DEFAULT_LIMIT,
    ) -> list[CashFlowStatement]: ...

    async def get_ratios(
        self,
        symbol: str,
        *,
        period: FundamentalsPeriod = "quarter",
        limit: int = _DEFAULT_LIMIT,
    ) -> list[FinancialRatios]: ...

    async def get_key_metrics(
        self,
        symbol: str,
        *,
        period: FundamentalsPeriod = "quarter",
        limit: int = _DEFAULT_LIMIT,
    ) -> list[KeyMetrics]: ...

    async def get_sector_peers(self, symbol: str, *, limit: int = 15) -> list[str]: ...


def _normalize_symbol(symbol: str) -> str:
    return normalize_fundamentals_symbol(symbol)


def _clamp_limit(limit: int, *, max_limit: int = _MAX_LIMIT) -> int:
    return clamp_fundamentals_limit(limit, max_limit=max_limit)


def _normalize_period(period: str) -> FundamentalsPeriod:
    p = str(period or "").strip().lower()
    if p == "annual":
        return "annual"
    return "quarter"


def _api_key() -> str:
    return str(get_settings().fmp_api_key or "").strip()


def _cache_get(key: str) -> str | None:
    r = get_sync_redis()
    if r is None:
        return None
    try:
        val = r.get(key)
        return str(val) if val else None
    except Exception:
        return None


def _cache_set(key: str, value: str) -> None:
    r = get_sync_redis()
    if r is None:
        return
    try:
        r.setex(key, _CACHE_TTL_SEC, value)
    except Exception:
        pass


def _statement_cache_key(endpoint: str, symbol: str, period: FundamentalsPeriod, limit: int) -> str:
    return f"stocvest:fmp:position:{endpoint}:v1:{symbol}:{period}:{limit}"


def _peers_cache_key(symbol: str, limit: int) -> str:
    return f"stocvest:fmp:position:peers:v1:{symbol}:{limit}"


def _parse_rows(
    raw: Any,
    parser: Callable[[dict[str, Any]], TModel | None],
    *,
    expected_symbol: str,
) -> list[TModel]:
    if not isinstance(raw, list):
        return []
    out: list[TModel] = []
    seen_dates: set[Any] = set()
    for row in raw:
        if not isinstance(row, dict):
            continue
        parsed = parser(row)
        if parsed is None:
            continue
        row_symbol = cast(Any, parsed).symbol
        if row_symbol != expected_symbol:
            continue
        as_of = cast(Any, parsed).as_of_date
        if as_of in seen_dates:
            continue
        seen_dates.add(as_of)
        out.append(parsed)
    out.sort(key=lambda r: cast(Any, r).as_of_date, reverse=True)
    return out


def _serialize_models(rows: list[Any]) -> str:
    payload = [row.model_dump(mode="json") for row in rows]
    return json.dumps(payload)


def _deserialize_models(raw_json: str, model_cls: type[TModel]) -> list[TModel]:
    try:
        payload = json.loads(raw_json)
    except (TypeError, ValueError, json.JSONDecodeError):
        return []
    if not isinstance(payload, list):
        return []
    out: list[TModel] = []
    for row in payload:
        if not isinstance(row, dict):
            continue
        try:
            out.append(model_cls.model_validate(row))  # type: ignore[attr-defined]
        except Exception:
            continue
    out.sort(key=lambda r: cast(Any, r).as_of_date, reverse=True)
    return out


async def _fetch_fmp_list(
    endpoint: str,
    symbol: str,
    *,
    period: FundamentalsPeriod,
    limit: int,
    parser: Callable[[dict[str, Any]], TModel | None],
    model_cls: type[TModel],
) -> list[TModel]:
    sym = _normalize_symbol(symbol)
    if not sym:
        return []
    key = _api_key()
    if not key:
        return []

    lim = _clamp_limit(limit)
    per = _normalize_period(period)
    cache_key = _statement_cache_key(endpoint, sym, per, lim)
    cached = _cache_get(cache_key)
    if cached is not None:
        rows = _deserialize_models(cached, model_cls)
        # Trust empty only when explicitly cached; corrupt payloads refetch.
        if rows or cached.strip() == "[]":
            return rows

    rows: list[TModel] = []
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(12.0)) as client:
            resp = await client.get(
                f"{FMP_STABLE_BASE}/{endpoint}",
                params={
                    "symbol": sym,
                    "period": per,
                    "limit": str(lim),
                    "apikey": key,
                },
            )
            resp.raise_for_status()
            rows = _parse_rows(resp.json(), parser, expected_symbol=sym)
    except Exception as exc:
        _LOG.warning(
            "fmp_position_fetch_failed endpoint=%s symbol=%s err=%s",
            endpoint,
            sym,
            type(exc).__name__,
        )
        return []

    _cache_set(cache_key, _serialize_models(rows))
    return rows


def _normalize_peer_symbols(raw: Any, *, subject: str, limit: int) -> list[str]:
    peers: list[str] = []
    seen: set[str] = set()
    subject_u = _normalize_symbol(subject)

    def _add(candidate: str) -> None:
        sym = _normalize_symbol(candidate)
        if not sym or sym == subject_u or sym in seen:
            return
        seen.add(sym)
        peers.append(sym)

    def _consume(item: Any) -> None:
        if isinstance(item, str):
            if "," in item:
                for part in item.split(","):
                    _add(part)
            else:
                _add(item)
        elif isinstance(item, dict):
            peers_list = item.get("peersList") or item.get("peers")
            if isinstance(peers_list, str):
                for part in peers_list.split(","):
                    _add(part)
            else:
                _add(str(item.get("symbol") or item.get("ticker") or ""))

    if isinstance(raw, list):
        for item in raw:
            _consume(item)
    elif isinstance(raw, dict):
        _consume(raw)

    if len(peers) > limit:
        peers = peers[:limit]
    return peers


class FMPFundamentalsProvider:
    """Live FMP-backed provider for Position fundamentals."""

    async def get_income_statements(
        self,
        symbol: str,
        *,
        period: FundamentalsPeriod = "quarter",
        limit: int = _DEFAULT_LIMIT,
    ) -> list[IncomeStatement]:
        return await _fetch_fmp_list(
            "income-statement",
            symbol,
            period=period,
            limit=limit,
            parser=IncomeStatement.from_fmp_row,
            model_cls=IncomeStatement,
        )

    async def get_balance_sheets(
        self,
        symbol: str,
        *,
        period: FundamentalsPeriod = "quarter",
        limit: int = _DEFAULT_LIMIT,
    ) -> list[BalanceSheet]:
        return await _fetch_fmp_list(
            "balance-sheet-statement",
            symbol,
            period=period,
            limit=limit,
            parser=BalanceSheet.from_fmp_row,
            model_cls=BalanceSheet,
        )

    async def get_cash_flows(
        self,
        symbol: str,
        *,
        period: FundamentalsPeriod = "quarter",
        limit: int = _DEFAULT_LIMIT,
    ) -> list[CashFlowStatement]:
        return await _fetch_fmp_list(
            "cash-flow-statement",
            symbol,
            period=period,
            limit=limit,
            parser=CashFlowStatement.from_fmp_row,
            model_cls=CashFlowStatement,
        )

    async def get_ratios(
        self,
        symbol: str,
        *,
        period: FundamentalsPeriod = "quarter",
        limit: int = _DEFAULT_LIMIT,
    ) -> list[FinancialRatios]:
        return await _fetch_fmp_list(
            "ratios",
            symbol,
            period=period,
            limit=limit,
            parser=FinancialRatios.from_fmp_row,
            model_cls=FinancialRatios,
        )

    async def get_key_metrics(
        self,
        symbol: str,
        *,
        period: FundamentalsPeriod = "quarter",
        limit: int = _DEFAULT_LIMIT,
    ) -> list[KeyMetrics]:
        return await _fetch_fmp_list(
            "key-metrics",
            symbol,
            period=period,
            limit=limit,
            parser=KeyMetrics.from_fmp_row,
            model_cls=KeyMetrics,
        )

    async def get_sector_peers(self, symbol: str, *, limit: int = 15) -> list[str]:
        sym = _normalize_symbol(symbol)
        if not sym:
            return []
        key = _api_key()
        if not key:
            return []

        lim = _clamp_limit(limit, max_limit=_MAX_PEER_LIMIT)
        cache_key = _peers_cache_key(sym, lim)
        cached = _cache_get(cache_key)
        if cached is not None:
            try:
                payload = json.loads(cached)
            except (TypeError, ValueError, json.JSONDecodeError):
                payload = None
            if isinstance(payload, list):
                return _normalize_peer_symbols(payload, subject=sym, limit=lim)

        peers: list[str] = []
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(12.0)) as client:
                resp = await client.get(
                    f"{FMP_STABLE_BASE}/stock-peers",
                    params={"symbol": sym, "apikey": key},
                )
                resp.raise_for_status()
                peers = _normalize_peer_symbols(resp.json(), subject=sym, limit=lim)
        except Exception as exc:
            _LOG.warning(
                "fmp_position_peers_failed symbol=%s err=%s",
                sym,
                type(exc).__name__,
            )
            return []

        _cache_set(cache_key, json.dumps(peers))
        return peers


@dataclass
class FundamentalsProviderFixtures:
    """In-memory fixtures keyed by uppercase symbol."""

    income_statements: dict[str, list[IncomeStatement]] = field(default_factory=dict)
    balance_sheets: dict[str, list[BalanceSheet]] = field(default_factory=dict)
    cash_flows: dict[str, list[CashFlowStatement]] = field(default_factory=dict)
    ratios: dict[str, list[FinancialRatios]] = field(default_factory=dict)
    key_metrics: dict[str, list[KeyMetrics]] = field(default_factory=dict)
    sector_peers: dict[str, list[str]] = field(default_factory=dict)

    def _slice(
        self,
        store: dict[str, list[Any]],
        symbol: str,
        limit: int,
    ) -> list[Any]:
        sym = _normalize_symbol(symbol)
        rows = list(store.get(sym, []))
        if not rows and sym != symbol.strip().upper():
            rows = list(store.get(symbol.strip().upper(), []))
        rows.sort(key=lambda r: r.as_of_date, reverse=True)
        return rows[: _clamp_limit(limit)]


class FundamentalsProviderMock:
    """Deterministic provider for unit tests — no network."""

    def __init__(self, fixtures: FundamentalsProviderFixtures | None = None) -> None:
        self._fixtures = fixtures or FundamentalsProviderFixtures()
        self.call_log: list[tuple[str, str]] = []

    def _log(self, method: str, symbol: str) -> None:
        self.call_log.append((method, _normalize_symbol(symbol)))

    async def get_income_statements(
        self,
        symbol: str,
        *,
        period: FundamentalsPeriod = "quarter",
        limit: int = _DEFAULT_LIMIT,
    ) -> list[IncomeStatement]:
        self._log("income", symbol)
        _ = period
        return cast(list[IncomeStatement], self._fixtures._slice(self._fixtures.income_statements, symbol, limit))

    async def get_balance_sheets(
        self,
        symbol: str,
        *,
        period: FundamentalsPeriod = "quarter",
        limit: int = _DEFAULT_LIMIT,
    ) -> list[BalanceSheet]:
        self._log("balance", symbol)
        _ = period
        return cast(list[BalanceSheet], self._fixtures._slice(self._fixtures.balance_sheets, symbol, limit))

    async def get_cash_flows(
        self,
        symbol: str,
        *,
        period: FundamentalsPeriod = "quarter",
        limit: int = _DEFAULT_LIMIT,
    ) -> list[CashFlowStatement]:
        self._log("cash_flow", symbol)
        _ = period
        return cast(list[CashFlowStatement], self._fixtures._slice(self._fixtures.cash_flows, symbol, limit))

    async def get_ratios(
        self,
        symbol: str,
        *,
        period: FundamentalsPeriod = "quarter",
        limit: int = _DEFAULT_LIMIT,
    ) -> list[FinancialRatios]:
        self._log("ratios", symbol)
        _ = period
        return cast(list[FinancialRatios], self._fixtures._slice(self._fixtures.ratios, symbol, limit))

    async def get_key_metrics(
        self,
        symbol: str,
        *,
        period: FundamentalsPeriod = "quarter",
        limit: int = _DEFAULT_LIMIT,
    ) -> list[KeyMetrics]:
        self._log("key_metrics", symbol)
        _ = period
        return cast(list[KeyMetrics], self._fixtures._slice(self._fixtures.key_metrics, symbol, limit))

    async def get_sector_peers(self, symbol: str, *, limit: int = 15) -> list[str]:
        self._log("peers", symbol)
        sym = _normalize_symbol(symbol)
        lim = _clamp_limit(limit, max_limit=_MAX_PEER_LIMIT)
        return _normalize_peer_symbols(self._fixtures.sector_peers.get(sym, []), subject=sym, limit=lim)


def get_fundamentals_provider(
    *,
    mock: FundamentalsProviderMock | None = None,
) -> FundamentalsProvider:
    if mock is not None:
        return mock
    return FMPFundamentalsProvider()


async def fetch_position_fundamentals_snapshot(
    symbol: str,
    provider: FundamentalsProvider | None = None,
    *,
    period: FundamentalsPeriod = "quarter",
    limit: int = _DEFAULT_LIMIT,
) -> PositionFundamentalsSnapshot:
    """Fetch all statement families in parallel for one symbol (POS-D2 entry point)."""
    sym = _normalize_symbol(symbol)
    prov = provider or get_fundamentals_provider()
    configured = bool(_api_key()) or isinstance(prov, FundamentalsProviderMock)

    if not sym:
        return PositionFundamentalsSnapshot(symbol="", configured=configured, data_quality="unavailable")

    (
        income,
        balance,
        cash_flow,
        ratios,
        metrics,
        peers,
    ) = await asyncio.gather(
        prov.get_income_statements(sym, period=period, limit=limit),
        prov.get_balance_sheets(sym, period=period, limit=limit),
        prov.get_cash_flows(sym, period=period, limit=limit),
        prov.get_ratios(sym, period=period, limit=limit),
        prov.get_key_metrics(sym, period=period, limit=limit),
        prov.get_sector_peers(sym),
        return_exceptions=True,
    )

    def _safe_list(result: Any, label: str) -> list[Any]:
        if isinstance(result, Exception):
            _LOG.warning(
                "position_snapshot_partial_failed symbol=%s part=%s err=%s",
                sym,
                label,
                type(result).__name__,
            )
            return []
        return result if isinstance(result, list) else []

    income = _safe_list(income, "income")
    balance = _safe_list(balance, "balance")
    cash_flow = _safe_list(cash_flow, "cash_flow")
    ratios = _safe_list(ratios, "ratios")
    metrics = _safe_list(metrics, "key_metrics")
    peers = _safe_list(peers, "peers")

    snapshot = PositionFundamentalsSnapshot(
        symbol=sym,
        income_statements=income,
        balance_sheets=balance,
        cash_flows=cash_flow,
        ratios=ratios,
        key_metrics=metrics,
        sector_peers=peers,
        configured=configured,
    )
    return snapshot.model_copy(update={"data_quality": assess_snapshot_data_quality(snapshot)})
