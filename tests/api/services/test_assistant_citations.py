"""Unit tests for the assistant source-citation builder."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from stocvest.api.services.assistant_citations import build_citations


class _Article:
    """Minimal duck-typed stand-in for NewsArticle / BenzingaArticle."""

    def __init__(self, *, title, url, source, published_at, tickers=None):
        self.title = title
        self.url = url
        self.source = source
        self.published_at = published_at
        self.tickers = tickers or []


class _Ctx:
    def __init__(self, *, news=None, benzinga_news=None, symbol=""):
        self.news = news or []
        self.benzinga_news = benzinga_news or []
        self.symbol = symbol


def test_build_citations_returns_none_for_no_context() -> None:
    assert build_citations(None) is None


def test_build_citations_returns_none_when_no_linkable_sources() -> None:
    ctx = _Ctx(news=[_Article(title="No link", url=None, source="x", published_at=None)])
    assert build_citations(ctx) is None


def test_build_citations_orders_recent_first_and_dedupes() -> None:
    now = datetime.now(timezone.utc)
    ctx = _Ctx(
        benzinga_news=[
            _Article(title="Older", url="https://e.com/old", source="Benzinga", published_at=now - timedelta(days=1)),
            _Article(title="Newest", url="https://e.com/new", source="Benzinga", published_at=now),
        ],
        news=[
            # Duplicate URL must be dropped.
            _Article(title="Dup", url="https://e.com/new", source="Polygon", published_at=now),
            _Article(title="Mid", url="https://e.com/mid", source="Reuters", published_at=now - timedelta(hours=3)),
        ],
    )
    out = build_citations(ctx)
    assert out is not None
    urls = [c["url"] for c in out]
    assert urls[0] == "https://e.com/new"  # newest first
    assert urls.count("https://e.com/new") == 1  # de-duped
    assert "https://e.com/mid" in urls


def test_build_citations_skips_non_http_urls() -> None:
    ctx = _Ctx(
        news=[
            _Article(title="ftp", url="ftp://nope", source="x", published_at=None),
            _Article(title="ok", url="https://ok.com", source="x", published_at=None),
        ]
    )
    out = build_citations(ctx)
    assert out is not None
    assert [c["url"] for c in out] == ["https://ok.com"]


def test_build_citations_caps_at_four() -> None:
    now = datetime.now(timezone.utc)
    arts = [
        _Article(title=f"a{i}", url=f"https://e.com/{i}", source="Benzinga", published_at=now - timedelta(minutes=i))
        for i in range(8)
    ]
    out = build_citations(_Ctx(benzinga_news=arts))
    assert out is not None
    assert len(out) == 4


def test_build_citations_ranks_on_ticker_above_newer_off_ticker() -> None:
    now = datetime.now(timezone.utc)
    ctx = _Ctx(
        symbol="AVGO",
        news=[
            # Newer, but it's a different company's story merely tagged with AVGO.
            _Article(
                title="C3 AI Stock Flies After Q4 Earnings",
                url="https://e.com/c3ai",
                source="Benzinga",
                published_at=now,
                tickers=["AI", "NVDA", "AVGO", "PLTR", "SMCI", "MSFT"],
            ),
            # Slightly older, but it's the AVGO earnings story (AVGO primary).
            _Article(
                title="Broadcom Announces Q2 FY2026 Results",
                url="https://e.com/avgo",
                source="GlobeNewswire",
                published_at=now - timedelta(hours=1),
                tickers=["AVGO"],
            ),
        ],
    )
    out = build_citations(ctx)
    assert out is not None
    # The on-target AVGO story leads despite being slightly older.
    assert out[0]["url"] == "https://e.com/avgo"


def test_build_citations_uses_real_publisher_source() -> None:
    ctx = _Ctx(
        symbol="AVGO",
        news=[_Article(title="Broadcom news", url="https://e.com/a", source="GlobeNewswire", published_at=None, tickers=["AVGO"])],
    )
    out = build_citations(ctx)
    assert out is not None
    assert out[0]["source"] == "GlobeNewswire"


def test_build_citations_handles_mixed_aware_and_naive_datetimes() -> None:
    aware = datetime.now(timezone.utc)
    naive = datetime(2026, 6, 1, 12, 0, 0)
    ctx = _Ctx(
        benzinga_news=[_Article(title="aware", url="https://e.com/a", source="B", published_at=aware)],
        news=[_Article(title="naive", url="https://e.com/n", source="R", published_at=naive)],
    )
    # Must not raise a TypeError comparing aware vs naive datetimes.
    out = build_citations(ctx)
    assert out is not None
    assert len(out) == 2
