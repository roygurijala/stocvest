from unittest.mock import patch

from stocvest.data.ticker_name_resolver import (
    TickerNameResolver,
    article_matches_ticker,
    build_name_variants,
)


def test_build_name_variants_apple() -> None:
    v = build_name_variants("Apple Inc.")
    assert "Apple Inc." in v or "Apple Inc" in v
    assert "Apple" in v


def test_build_name_variants_jpmorgan() -> None:
    v = build_name_variants("JPMorgan Chase & Co.")
    joined = " ".join(v)
    assert any(x in joined for x in ["JPMorgan Chase", "JPMorgan", "Chase"])


def test_build_name_variants_meta() -> None:
    v = build_name_variants("Meta Platforms, Inc.")
    assert any("Meta Platforms" in x or x.startswith("Meta") for x in v)


def test_sec_load_populates_cache() -> None:
    fake = {
        "1": {"ticker": "AAA", "title": "Alpha Corp"},
        "2": {"ticker": "BBB", "title": "Beta Holdings"},
        "3": {"ticker": "CCC", "title": "Gamma Technologies"},
        "4": {"ticker": "DDD", "title": "Delta Solutions"},
        "5": {"ticker": "EEE", "title": "Epsilon Group"},
    }
    TickerNameResolver._memory_cache.clear()
    TickerNameResolver._sec_loaded = False

    class FakeResp:
        status_code = 200

        def raise_for_status(self) -> None:
            return

        def json(self) -> dict:
            return fake

    with patch("httpx.get", return_value=FakeResp()):
        res = TickerNameResolver()
        assert res.get_name_variants("AAA")
        assert "BBB" in TickerNameResolver._memory_cache
        assert len([k for k in ["AAA", "BBB", "CCC", "DDD", "EEE"] if k in TickerNameResolver._memory_cache]) == 5


def test_article_matches_exact_ticker() -> None:
    assert article_matches_ticker("Something", ["AAPL"], "AAPL") is True


def test_article_matches_company_name() -> None:
    TickerNameResolver._memory_cache.clear()
    TickerNameResolver._memory_cache["AAPL"] = ["Apple Inc.", "Apple"]
    TickerNameResolver._sec_loaded = True
    title = "Apple beats Q2 earnings estimates"
    assert article_matches_ticker(title, [], "AAPL") is True


def test_article_no_match() -> None:
    assert article_matches_ticker("Market update for the week", ["XOM"], "AAPL") is False


def test_sec_failure_returns_symbol_fallback() -> None:
    TickerNameResolver._memory_cache.clear()
    TickerNameResolver._sec_loaded = False
    with patch("httpx.get", side_effect=RuntimeError("boom")):
        variants = TickerNameResolver().get_name_variants("ZZZZ")
    assert variants == ["ZZZZ"]
