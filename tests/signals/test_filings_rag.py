"""Unit tests for the POS-AI-10 filings retrieval (RAG retrieval layer)."""

from __future__ import annotations

import pytest

from stocvest.signals.filings_rag import (
    build_filings_digest,
    chunk_sections,
    retrieve,
    score_chunk,
)

pytestmark = pytest.mark.unit

_URL = "https://www.sec.gov/x/co-10k.htm"


def _long(sentence: str, times: int) -> str:
    return " ".join([sentence] * times)


def test_chunk_sections_splits_and_drops_tiny() -> None:
    text = _long("Revenue grew as demand for our products expanded.", 12)
    chunks = chunk_sections(
        [("item7", "Item 7 · MD&A", text)], source_url=_URL, chunk_chars=200
    )
    assert len(chunks) >= 2
    assert all(c.section_label == "Item 7 · MD&A" for c in chunks)
    assert all(c.source_url == _URL for c in chunks)
    # Every emitted chunk clears the min-chunk floor.
    assert all(len(c.text) >= 120 for c in chunks)


def test_chunk_sections_ignores_empty_text() -> None:
    assert chunk_sections([("item1", "Item 1", "")], source_url=_URL) == []


def test_score_chunk_zero_without_overlap() -> None:
    assert score_chunk(["alpha", "beta"], {"gamma"}) == 0.0
    assert score_chunk([], {"alpha"}) == 0.0
    assert score_chunk(["alpha"], set()) == 0.0


def test_score_chunk_positive_and_length_normalized() -> None:
    short = score_chunk(["margin", "margin"], {"margin"})
    long = score_chunk(["margin", "margin"] + ["filler"] * 20, {"margin"})
    assert short > 0 and long > 0
    assert short > long  # same hits, longer chunk is penalized


def test_retrieve_ranks_relevant_first() -> None:
    chunks = chunk_sections(
        [
            ("item7", "Item 7 · MD&A", _long("Gross margin expanded on pricing and cost control.", 4)),
            ("item1a", "Item 1A · Risk Factors", _long("Litigation and regulation could harm results.", 4)),
        ],
        source_url=_URL,
        chunk_chars=400,
    )
    top = retrieve(chunks, "margin profitability cost pricing", k=1)
    assert top
    assert "margin" in top[0][0].text.lower()
    assert top[0][1] > 0


def test_retrieve_empty_when_no_match() -> None:
    chunks = chunk_sections(
        [("item1", "Item 1 · Business", _long("We design and sell consumer devices.", 4))],
        source_url=_URL,
        chunk_chars=400,
    )
    assert retrieve(chunks, "cryptography quantum tunneling", k=3) == []


def test_build_filings_digest_dedups_and_caps() -> None:
    sections = [
        ("item1", "Item 1 · Business", _long("We sell devices and services to consumers worldwide.", 5)),
        ("item1a", "Item 1A · Risk Factors", _long("Supply chain and regulation are key risks and litigation.", 5)),
        ("item7", "Item 7 · MD&A", _long("Revenue and gross margin grew on strong demand and pricing.", 5)),
    ]
    digest = build_filings_digest(
        "aapl", sections, source_url=_URL, filing_date="2025-10-30", form="10-K", max_passages=3
    )
    assert digest is not None
    assert digest.symbol == "AAPL"
    assert digest.form == "10-K"
    assert 1 <= len(digest.passages) <= 3
    # Deduped: no two passages share identical text.
    texts = [p.text for p in digest.passages]
    assert len(texts) == len(set(texts))
    # Sorted by score desc.
    scores = [p.score for p in digest.passages]
    assert scores == sorted(scores, reverse=True)
    d = digest.to_api_dict()
    assert d["scored"] is False
    assert d["passages"][0]["section_label"]


def test_build_filings_digest_none_when_no_chunks() -> None:
    assert build_filings_digest("AAPL", [], source_url=_URL) is None
    assert build_filings_digest("AAPL", [("item1", "Item 1", "too short")], source_url=_URL) is None
