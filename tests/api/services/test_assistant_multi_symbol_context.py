"""Tests for stocvest.api.services.assistant_multi_symbol_context.

Covers the comparison summary builder, the serialized side-by-side block, the UI
payload, and the parallel fetch (with stubbed single-symbol fetchers).
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone

import pytest


def _run(coro):
    return asyncio.run(coro)

from stocvest.api.services import assistant_multi_symbol_context as mod
from stocvest.api.services.assistant_multi_symbol_context import (
    fetch_multi_symbol_context,
    multi_symbol_payload,
    serialize_multi_symbol_context,
)
from stocvest.api.services.assistant_symbol_context import AssistantSymbolContext
from stocvest.data.benzinga_client import BenzingaRating
from stocvest.data.models import Snapshot

pytestmark = pytest.mark.unit


def _rating(pt: float) -> BenzingaRating:
    return BenzingaRating(
        symbol="X",
        action="Maintains",
        rating="Buy",
        price_target=pt,
        analyst_firm="TestFirm",
        published_at=datetime.now(timezone.utc),
    )


def _ctx(symbol: str, price: float, change: float, targets: list[float] | None = None) -> AssistantSymbolContext:
    return AssistantSymbolContext(
        symbol=symbol,
        snapshot=Snapshot(symbol=symbol, last_trade_price=price, change_percent=change),
        analyst_ratings=[_rating(t) for t in (targets or [])],
    )


def _read(verdict: str, *, bullish: int, bearish: int, neutral: int, available: int,
          alignment: str | None = None, limitations: list[str] | None = None,
          stale: bool = False) -> dict:
    read: dict = {
        "verdict": verdict,
        "leans": {"bullish": bullish, "bearish": bearish, "neutral": neutral, "available": available},
    }
    if alignment:
        read["alignment_label"] = alignment
    if limitations:
        read["limitations"] = limitations
    if stale:
        read["stale"] = True
    return read


# ── _summarize ───────────────────────────────────────────────────────────────


def test_summarize_builds_compact_row_with_read_and_targets() -> None:
    ctx = _ctx("NVDA", 100.0, 1.5, targets=[120.0, 140.0])
    read = _read("bullish", bullish=5, bearish=1, neutral=0, available=6, alignment="High")
    row = mod._summarize("NVDA", ctx, read)
    assert row["symbol"] == "NVDA"
    assert row["has_data"] is True
    assert row["price"] == 100.0
    assert row["change_percent"] == 1.5
    assert row["verdict"] == "bullish"
    assert row["alignment"] == "High"
    assert row["analyst_avg_target"] == 130.0
    # implied = (130 - 100) / 100 = +30%
    assert row["analyst_implied_pct"] == 30.0
    assert row["leans"]["bullish"] == 5


def test_summarize_no_data_when_ctx_empty() -> None:
    ctx = AssistantSymbolContext(symbol="AMD")  # no snapshot/news/bars
    row = mod._summarize("AMD", ctx, None)
    assert row == {"symbol": "AMD", "has_data": False}


# ── serialize_multi_symbol_context ───────────────────────────────────────────


def test_serialize_renders_side_by_side_no_winner_language() -> None:
    rows = [
        mod._summarize("NVDA", _ctx("NVDA", 100.0, 1.0, [130.0]),
                       _read("bullish", bullish=5, bearish=0, neutral=1, available=6, alignment="High")),
        mod._summarize("AMD", _ctx("AMD", 50.0, -0.5, [55.0]),
                       _read("neutral", bullish=2, bearish=2, neutral=2, available=6,
                             limitations=["the layers are split — 2 lean bullish and 2 lean bearish"])),
    ]
    block = serialize_multi_symbol_context(rows)
    assert "MULTI-SYMBOL COMPARISON: NVDA, AMD" in block
    assert "NVDA:" in block and "AMD:" in block
    assert "stocvest_read=bullish" in block
    assert "stocvest_read=neutral" in block
    assert "not_yet_confirmed" in block
    # Never tells the model to pick a winner.
    assert "do not rank" in block.lower() or "do NOT rank" in block


def test_serialize_notes_missing_read_for_uncovered_symbol() -> None:
    rows = [
        mod._summarize("NVDA", _ctx("NVDA", 100.0, 1.0), _read("bullish", bullish=5, bearish=0, neutral=1, available=6)),
        mod._summarize("AMD", _ctx("AMD", 50.0, -0.5), None),
    ]
    block = serialize_multi_symbol_context(rows)
    assert "no recent STOCVEST evaluation cached" in block


def test_serialize_empty_when_fewer_than_two_have_data() -> None:
    rows = [
        mod._summarize("NVDA", _ctx("NVDA", 100.0, 1.0), None),
        {"symbol": "AMD", "has_data": False},
    ]
    assert serialize_multi_symbol_context(rows) == ""


# ── multi_symbol_payload ─────────────────────────────────────────────────────


def test_payload_compact_chips() -> None:
    rows = [
        mod._summarize("NVDA", _ctx("NVDA", 100.0, 1.0), _read("bullish", bullish=5, bearish=0, neutral=1, available=6, alignment="High")),
        mod._summarize("AMD", _ctx("AMD", 50.0, -0.5), _read("neutral", bullish=2, bearish=2, neutral=2, available=6)),
    ]
    payload = multi_symbol_payload(rows)
    assert payload is not None
    assert [p["symbol"] for p in payload] == ["NVDA", "AMD"]
    assert payload[0]["verdict"] == "bullish"
    assert payload[0]["alignment"] == "High"


def test_payload_none_when_insufficient_data() -> None:
    rows = [{"symbol": "NVDA", "has_data": False}, {"symbol": "AMD", "has_data": False}]
    assert multi_symbol_payload(rows) is None


# ── fetch_multi_symbol_context ───────────────────────────────────────────────


def test_fetch_multi_symbol_context_parallel(monkeypatch: pytest.MonkeyPatch) -> None:
    ctxs = {
        "NVDA": _ctx("NVDA", 100.0, 1.0, [130.0]),
        "AMD": _ctx("AMD", 50.0, -0.5, [55.0]),
    }
    reads = {
        "NVDA": _read("bullish", bullish=5, bearish=0, neutral=1, available=6, alignment="High"),
        "AMD": _read("neutral", bullish=2, bearish=2, neutral=2, available=6),
    }

    async def _fake_fetch(sym: str):
        return ctxs.get(sym)

    monkeypatch.setattr(mod, "fetch_assistant_symbol_context", _fake_fetch)
    monkeypatch.setattr(mod, "fetch_stocvest_composite_read", lambda sym, mode: reads.get(sym))

    out = _run(fetch_multi_symbol_context(["NVDA", "AMD"], "day"))
    assert [r["symbol"] for r in out] == ["NVDA", "AMD"]
    assert out[0]["verdict"] == "bullish"
    assert out[1]["verdict"] == "neutral"


def test_fetch_multi_symbol_context_dedupes_and_requires_two(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _fake_fetch(sym: str):
        return _ctx(sym, 10.0, 0.0)

    monkeypatch.setattr(mod, "fetch_assistant_symbol_context", _fake_fetch)
    monkeypatch.setattr(mod, "fetch_stocvest_composite_read", lambda sym, mode: None)

    # Only one distinct symbol → empty (not a comparison).
    assert _run(fetch_multi_symbol_context(["NVDA", "NVDA"], "day")) == []


def test_fetch_multi_symbol_context_degrades_on_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _fake_fetch(sym: str):
        if sym == "AMD":
            raise RuntimeError("boom")
        return _ctx(sym, 10.0, 0.0)

    monkeypatch.setattr(mod, "fetch_assistant_symbol_context", _fake_fetch)
    monkeypatch.setattr(mod, "fetch_stocvest_composite_read", lambda sym, mode: None)

    out = _run(fetch_multi_symbol_context(["NVDA", "AMD"], "day"))
    assert len(out) == 2
    amd = next(r for r in out if r["symbol"] == "AMD")
    assert amd["has_data"] is False
