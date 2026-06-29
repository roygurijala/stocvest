"""Tests for stocvest.api.services.assistant_web_context.

The Perplexity client is mocked — no real web calls are made.
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, patch

from stocvest.api.services.assistant_web_context import (
    AssistantWebContext,
    fetch_web_context,
    serialize_web_context,
    web_sources_payload,
)


def _run(coro):
    return asyncio.run(coro)


def _patch_sonar(value):
    return patch(
        "stocvest.api.services.assistant_web_context.perplexity_sonar_json",
        new=AsyncMock(return_value=value),
    )


def test_fetch_web_context_parses_answer_points_sources() -> None:
    payload = {
        "answer": "The Fed held rates steady at its latest meeting.",
        "key_points": ["No change to the target range", "Dot plot signals one cut"],
        "sources": [
            {"title": "Reuters", "url": "https://reuters.com/fed"},
            {"title": "Bloomberg", "url": "https://bloomberg.com/fed"},
        ],
    }
    with _patch_sonar(payload):
        ctx = _run(fetch_web_context("what's the latest on the fed?"))
    assert ctx is not None
    assert ctx.has_data
    assert "Fed held rates" in ctx.answer
    assert len(ctx.key_points) == 2
    assert ctx.sources[0] == {"title": "Reuters", "url": "https://reuters.com/fed"}


def test_fetch_web_context_none_when_no_data() -> None:
    with _patch_sonar(None):
        assert _run(fetch_web_context("what's the latest on the fed?")) is None


def test_fetch_web_context_none_on_blank_query() -> None:
    assert _run(fetch_web_context("   ")) is None


def test_fetch_web_context_none_when_answer_empty() -> None:
    with _patch_sonar({"answer": "", "key_points": ["x"]}):
        assert _run(fetch_web_context("macro outlook today")) is None


def test_normalize_sources_accepts_bare_strings_and_dedupes() -> None:
    payload = {
        "answer": "Summary.",
        "sources": [
            "Plain Source",
            {"title": "Reuters", "url": "https://reuters.com/a"},
            {"title": "Reuters", "url": "https://reuters.com/a"},  # duplicate URL
            {"name": "WSJ", "link": "not-a-url"},  # non-http url dropped, title kept
        ],
    }
    with _patch_sonar(payload):
        ctx = _run(fetch_web_context("sector rotation this week"))
    assert ctx is not None
    assert {"title": "Plain Source"} in ctx.sources
    assert {"title": "Reuters", "url": "https://reuters.com/a"} in ctx.sources
    assert {"title": "WSJ"} in ctx.sources
    assert sum(1 for s in ctx.sources if s.get("title") == "Reuters") == 1


def test_serialize_web_context_renders_block() -> None:
    ctx = AssistantWebContext(
        query="fed",
        answer="Rates held steady.",
        key_points=["No change"],
        sources=[{"title": "Reuters", "url": "https://reuters.com/fed"}],
    )
    block = serialize_web_context(ctx)
    assert "WEB CONTEXT" in block
    assert "answer=Rates held steady." in block
    assert "No change" in block
    assert "https://reuters.com/fed" in block


def test_serialize_web_context_empty_when_no_data() -> None:
    assert serialize_web_context(None) == ""
    assert serialize_web_context(AssistantWebContext(query="x", answer="")) == ""


def test_web_sources_payload_none_when_empty() -> None:
    assert web_sources_payload(None) is None
    assert web_sources_payload(AssistantWebContext(query="x", answer="a", sources=[])) is None
    ctx = AssistantWebContext(query="x", answer="a", sources=[{"title": "R"}])
    assert web_sources_payload(ctx) == [{"title": "R"}]
