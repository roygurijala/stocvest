"""VIX / indices snapshot routing — mocked Polygon + optional live probe."""

from __future__ import annotations

import json
import os

import httpx
import pytest
import respx

from stocvest.api.handlers.market_data import snapshot_handler, snapshots_batch_handler, vix_snapshot_handler
from stocvest.api.services.morning_brief_fetch import get_vix_snapshot_with_fallback
from stocvest.data.polygon_client import PolygonClient
from stocvest.data.vix_snapshot import snapshot_has_usable_vix_pulse

FAKE_KEY = "test_api_key_12345"

INDICES_VIX_JSON = {
    "results": [
        {
            "ticker": "I:VIX",
            "value": 18.75,
            "market_status": "open",
            "session": {
                "change": 0.15,
                "change_percent": 0.8,
                "close": 18.75,
                "previous_close": 18.6,
            },
        }
    ]
}


def _mock_indices_and_stocks(*, stocks_tickers: list[dict] | None = None) -> None:
    respx.get(url__regex=r"https://api\.polygon\.io/v3/snapshot/indices.*").mock(
        return_value=httpx.Response(200, json=INDICES_VIX_JSON)
    )
    payload = {"status": "OK", "tickers": stocks_tickers or []}
    respx.get(url__regex=r"https://api\.polygon\.io/v2/snapshot/locale/us/markets/stocks/tickers.*").mock(
        return_value=httpx.Response(200, json=payload)
    )


@respx.mock
def test_vix_snapshot_handler_live_routing(monkeypatch: pytest.MonkeyPatch) -> None:
    """``GET /v1/market/vix-snapshot`` path uses indices API."""
    monkeypatch.setenv("POLYGON_API_KEY", FAKE_KEY)
    _mock_indices_and_stocks()

    response = vix_snapshot_handler({}, {}, client_factory=PolygonClient)
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    snap = body["snapshot"]
    assert snap is not None
    assert snap["symbol"] == "I:VIX"
    assert snap["last_trade_price"] == pytest.approx(18.75)


@respx.mock
def test_snapshot_handler_ivix_symbol(monkeypatch: pytest.MonkeyPatch) -> None:
    """``GET /v1/market/snapshot?symbol=I:VIX`` uses indices, not stocks ticker URL."""
    monkeypatch.setenv("POLYGON_API_KEY", FAKE_KEY)
    _mock_indices_and_stocks()
    stocks_single = respx.get(
        url__regex=r"https://api\.polygon\.io/v2/snapshot/locale/us/markets/stocks/tickers/I:VIX.*"
    ).mock(return_value=httpx.Response(404, json={"status": "NOT_FOUND"}))

    event = {"queryStringParameters": {"symbol": "I:VIX"}}
    response = snapshot_handler(event, {}, client_factory=PolygonClient)
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    assert body["symbol"] == "I:VIX"
    assert body["last_trade_price"] == pytest.approx(18.75)
    assert stocks_single.call_count == 0


@respx.mock
def test_snapshots_batch_spy_and_ivix(monkeypatch: pytest.MonkeyPatch) -> None:
    """``GET /v1/market/snapshots?symbols=SPY,I:VIX`` merges stocks + indices."""
    monkeypatch.setenv("POLYGON_API_KEY", FAKE_KEY)
    _mock_indices_and_stocks(
        stocks_tickers=[
            {
                "ticker": "SPY",
                "day": {"c": 501.0},
                "prevDay": {"c": 500.0},
                "lastTrade": {"p": 501.0},
            }
        ]
    )

    event = {"queryStringParameters": {"symbols": "SPY,I:VIX"}}
    response = snapshots_batch_handler(event, {}, client_factory=PolygonClient)
    assert response["statusCode"] == 200
    body = json.loads(response["body"])
    by_sym = {row["symbol"]: row for row in body["snapshots"]}
    assert "SPY" in by_sym and "I:VIX" in by_sym
    assert by_sym["SPY"]["last_trade_price"] == pytest.approx(501.0)
    assert by_sym["I:VIX"]["last_trade_price"] == pytest.approx(18.75)


@pytest.mark.asyncio
@respx.mock
async def test_get_vix_snapshot_with_fallback_uses_indices(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("POLYGON_API_KEY", FAKE_KEY)
    _mock_indices_and_stocks()
    respx.get(url__regex=r"https://api\.polygon\.io/v2/snapshot/locale/us/markets/stocks/tickers/.*").mock(
        return_value=httpx.Response(404, json={"status": "NOT_FOUND"})
    )

    async with PolygonClient(FAKE_KEY) as client:
        snap = await get_vix_snapshot_with_fallback(client)

    assert snap is not None
    assert snap.symbol == "I:VIX"
    assert snapshot_has_usable_vix_pulse(snap)


@pytest.mark.integration
@pytest.mark.asyncio
async def test_live_polygon_ivix_snapshot() -> None:
    """Optional live check — skipped when POLYGON_API_KEY is unset or plan lacks VIX."""
    from stocvest.data.polygon_client import PolygonError

    key = (os.environ.get("POLYGON_API_KEY") or "").strip()
    if not key:
        pytest.skip("POLYGON_API_KEY not set")

    async with PolygonClient(api_key=key) as client:
        try:
            snap = await client.get_snapshot("I:VIX")
        except PolygonError as exc:
            pytest.skip(f"Polygon VIX unavailable on this plan: {exc}")

        if not snapshot_has_usable_vix_pulse(snap):
            pytest.skip("Polygon returned VIX row without usable level or session %")

        batch = await client.get_snapshots(["SPY", "I:VIX"])
        if "I:VIX" not in batch or not snapshot_has_usable_vix_pulse(batch.get("I:VIX")):
            pytest.skip("Batch snapshots missing usable I:VIX on this plan")

        vix = await get_vix_snapshot_with_fallback(client)
        assert vix is not None and snapshot_has_usable_vix_pulse(vix)


@respx.mock
@pytest.mark.asyncio
async def test_get_vix_snapshot_with_fallback_uses_fred_when_indices_403(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When Polygon indices are 403, fallback chain must still return FRED VIXCLS."""
    from stocvest.data.fred_client import FRED_VIX_MARKET_STATUS

    monkeypatch.setenv("POLYGON_API_KEY", FAKE_KEY)
    monkeypatch.delenv("FRED_API_KEY", raising=False)
    monkeypatch.setenv("STOCVEST_DISABLE_REDIS", "1")
    from stocvest.utils.config import get_settings

    get_settings.cache_clear()

    respx.get(url__regex=r"https://api\.polygon\.io/v3/snapshot/indices.*").mock(
        return_value=httpx.Response(
            403,
            json={
                "status": "NOT_AUTHORIZED",
                "message": "You are not entitled to this data.",
            },
        )
    )
    respx.get(url__regex=r"https://api\.polygon\.io/v2/snapshot/locale/us/markets/stocks/tickers/.*").mock(
        return_value=httpx.Response(404, json={"status": "NOT_FOUND"})
    )
    csv_body = "DATE,VIXCLS\n2026-05-27,16.29\n2026-05-28,15.74\n"
    respx.get("https://fred.stlouisfed.org/graph/fredgraph.csv?id=VIXCLS").mock(
        return_value=httpx.Response(200, text=csv_body)
    )

    async with PolygonClient(FAKE_KEY) as client:
        vix = await get_vix_snapshot_with_fallback(client)

    get_settings.cache_clear()
    assert vix is not None
    assert snapshot_has_usable_vix_pulse(vix)
    assert vix.market_status == FRED_VIX_MARKET_STATUS
    assert vix.last_trade_price == pytest.approx(15.74)


@pytest.mark.integration
@pytest.mark.asyncio
async def test_live_vix_fallback_returns_fred_when_polygon_indices_blocked() -> None:
    """Optional live check — Polygon indices 403 + reachable FRED VIXCLS."""
    from stocvest.data.fred_client import FREDClient, FRED_VIX_MARKET_STATUS
    from stocvest.data.vix_snapshot import vix_level_from_snapshot

    key = (os.environ.get("POLYGON_API_KEY") or "").strip()
    if not key or key == "ci-dummy-key" or key.startswith("ci-"):
        pytest.skip("POLYGON_API_KEY not set or CI placeholder")

    fred_probe = await FREDClient().get_vix_snapshot()
    if fred_probe is None or not snapshot_has_usable_vix_pulse(fred_probe):
        pytest.skip("FRED VIXCLS unavailable (set FRED_API_KEY or retry when fredgraph CSV is up)")

    async with PolygonClient(api_key=key) as client:
        vix = await get_vix_snapshot_with_fallback(client)

    if vix is None:
        pytest.skip("VIX fallback returned nothing (Polygon/FRED both unavailable)")

    assert snapshot_has_usable_vix_pulse(vix)
    assert vix.market_status == FRED_VIX_MARKET_STATUS
    level = vix_level_from_snapshot(vix)
    assert level is not None and 5 < level < 100
