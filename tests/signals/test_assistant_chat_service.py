"""Service-level tests for AssistantChatService.

Covers the public (anonymous marketing) path. The authenticated path is exercised at the
handler layer in ``tests/api/handlers/test_signals_assistant_chat.py``.
"""

from __future__ import annotations

import asyncio
import math

import pytest

from stocvest.data.models import UserProfile
from stocvest.signals.assistant_chat import (
    AssistantChatService,
    HISTORICAL_VALIDATION_BLOCK_HEADER,
    serialize_historical_validation_summary,
)
from stocvest.signals.historical_validation import (
    BucketStats,
    HistoricalValidationSummary,
)


@pytest.fixture
def service() -> AssistantChatService:
    return AssistantChatService()


def test_reply_public_returns_intro_when_no_user_message(service: AssistantChatService) -> None:
    """Empty / non-user-tailed message list must produce a calm deterministic intro that
    explicitly invites the visitor to ask about STOCVEST or general finance terms."""
    result = asyncio.run(service.reply_public(messages=[]))
    assert result.source == "deterministic"
    assert result.mode == "general"
    assert result.upgrade_available is True
    assert "STOCVEST" in result.text


def test_reply_public_calls_claude_with_public_mode_marker(
    monkeypatch: pytest.MonkeyPatch, service: AssistantChatService
) -> None:
    """The PUBLIC MODE section of the locked system prompt only activates when the
    appended context block carries ``session_mode=public``. Verify we stamp exactly that
    marker before calling the LLM, never anything else."""
    captured: dict[str, object] = {}

    async def fake_claude(self, *, system, messages, max_tokens):  # type: ignore[no-untyped-def]
        captured["system"] = system
        captured["messages"] = list(messages)
        captured["max_tokens"] = max_tokens
        return "STOCVEST is a market analysis and decision-support platform."

    monkeypatch.setattr(
        "stocvest.signals.assistant_chat.AssistantChatService._claude_chat_or_none",
        fake_claude,
    )

    result = asyncio.run(
        service.reply_public(
            messages=[{"role": "user", "content": "What is STOCVEST?"}],
        )
    )
    assert result.source == "ai"
    assert result.mode == "general"
    assert result.upgrade_available is True
    system_text = captured.get("system")
    assert isinstance(system_text, str)
    # The appended PAGE CONTEXT block (the part the client controls) must carry the public
    # marker so the LLM routes into PUBLIC MODE RULES. We isolate the tail rather than scan
    # the whole prompt because the static instruction block now mentions
    # `session_mode=authenticated` as descriptive text inside the CRITICAL CONTEXT AWARENESS
    # RULE — that mention is a guardrail, not a routing signal.
    assert "=== PRODUCT FACTS (PUBLIC) ===" in system_text
    assert "swing_pro=$49/month" in system_text
    assert "=== PAGE CONTEXT ===" in system_text
    page_ctx_tail = system_text.split("=== PAGE CONTEXT ===", 1)[1]
    assert "session_mode=public" in page_ctx_tail
    # The appended tail must never hint at a logged-in / paid context for an anonymous caller.
    assert "session_mode=authenticated" not in page_ctx_tail
    assert "mode=contextual" not in page_ctx_tail


def test_reply_public_falls_back_to_deterministic_on_claude_outage(
    monkeypatch: pytest.MonkeyPatch, service: AssistantChatService
) -> None:
    """When Claude is unreachable the visitor still gets a calm deterministic answer —
    the marketing surface must never appear broken."""

    async def fake_claude(self, *, system, messages, max_tokens):  # type: ignore[no-untyped-def]
        return None

    monkeypatch.setattr(
        "stocvest.signals.assistant_chat.AssistantChatService._claude_chat_or_none",
        fake_claude,
    )

    result = asyncio.run(
        service.reply_public(messages=[{"role": "user", "content": "What is STOCVEST?"}])
    )
    assert result.source == "deterministic"
    assert result.mode == "general"
    assert "STOCVEST" in result.text


def test_reply_public_sanitizes_marketing_page_context_only(service: AssistantChatService) -> None:
    """Dashboard fields are stripped; marketing page id is preserved for product Q&A."""
    from stocvest.signals.assistant_prompts import sanitize_public_page_context

    assert sanitize_public_page_context({"page": "marketing/home"}) == {
        "page": "marketing/home",
        "session_mode": "public",
    }
    assert sanitize_public_page_context(
        {"page": "signals/layers", "symbol": "TTD", "decision_state": "monitor"}
    ) is None


# ─────────────────────────────────────────────────────────────────────────────
# Phase 3c-2 — historical validation context block
# ─────────────────────────────────────────────────────────────────────────────


def _bucket(
    *,
    total: int = 0,
    correct: int = 0,
    incorrect: int = 0,
    neutral: int = 0,
    accuracy: float = float("nan"),
) -> BucketStats:
    return BucketStats(
        total_signals=total,
        correct=correct,
        incorrect=incorrect,
        neutral=neutral,
        accuracy=accuracy,
    )


def _summary(
    *,
    rows_examined: int = 5,
    overall: BucketStats | None = None,
    by_mode: dict[str, BucketStats] | None = None,
) -> HistoricalValidationSummary:
    if overall is None:
        overall = _bucket(total=5, correct=3, incorrect=2, accuracy=0.6)
    if by_mode is None:
        by_mode = {
            "swing": _bucket(total=3, correct=2, incorrect=1, accuracy=2 / 3),
            "day": _bucket(total=2, correct=1, incorrect=1, accuracy=0.5),
        }
    return HistoricalValidationSummary(
        horizon="1d",
        overall=overall,
        by_decision={},
        by_regime={},
        by_mode=by_mode,
        by_pattern={},
        by_readiness={},
        by_direction={},
        by_environment={},
        by_capture_kind={},
        rows_examined=rows_examined,
        parameter_versions=("v1",),
    )


def test_serialize_historical_validation_returns_empty_string_for_none() -> None:
    """The chat service appends the block only when this helper returns non-empty —
    `None` summary (handler skipped or failed the fetch) means no block at all so the
    prompt's "if the field is absent, do not comment" rule activates."""
    assert serialize_historical_validation_summary(None, window_days=90) == ""


def test_serialize_historical_validation_returns_empty_for_zero_rows() -> None:
    """A user with no signals in the window must not get a tail block — otherwise the
    LLM might paraphrase the empty numbers as "your track record is zero", which is
    misleading. The handler / service treats zero-rows identically to a missing field."""
    empty = _summary(rows_examined=0, overall=_bucket(accuracy=float("nan")), by_mode={})
    assert serialize_historical_validation_summary(empty, window_days=90) == ""


def test_serialize_historical_validation_renders_overall_and_by_mode() -> None:
    """Happy path: the block carries window_days, horizon, overall with denominator
    transparency, and per-mode lines for any mode with rows. The header is the locked
    sentinel that the prompt rules pattern-match against."""
    block = serialize_historical_validation_summary(_summary(), window_days=90)

    assert block.startswith(HISTORICAL_VALIDATION_BLOCK_HEADER)
    assert "window_days=90" in block
    assert "horizon=1d" in block
    # Overall: 3 correct of 5 resolved at 60.0%.
    assert "overall=60.0% (3 correct of 5 resolved" in block
    assert "swing=66.7% (2 correct of 3 resolved" in block
    assert "day=50.0% (1 correct of 2 resolved" in block
    assert "rows_examined=5" in block


def test_serialize_historical_validation_renders_em_dash_for_nan_accuracy() -> None:
    """A bucket with NaN accuracy (no resolved-non-neutral trades) must render the
    em-dash — never "0.0%" (would mislead the LLM into saying "your accuracy is zero")
    and never the literal "NaN" string (would leak engine internals)."""
    summary = _summary(
        rows_examined=4,
        overall=_bucket(total=4, neutral=4, accuracy=float("nan")),
        by_mode={
            "swing": _bucket(total=4, neutral=4, accuracy=float("nan")),
        },
    )
    block = serialize_historical_validation_summary(summary, window_days=30)

    assert "overall=— " in block
    assert "swing=— " in block
    assert "NaN" not in block
    assert "0.0%" not in block


def test_serialize_historical_validation_omits_empty_mode_buckets() -> None:
    """Phase 1 pre-seeds the by_mode vocabulary so swing/day always appear as keys, even
    when one mode has zero rows. The serializer must NOT emit a line for an empty
    bucket — otherwise the LLM would see "day=— (0 correct of 0 resolved; 0 total)"
    and paraphrase it as "your day track has no data", which crosses from "I have
    nothing to say" into "I have something to say about nothing"."""
    summary = _summary(
        rows_examined=3,
        overall=_bucket(total=3, correct=2, incorrect=1, accuracy=2 / 3),
        by_mode={
            "swing": _bucket(total=3, correct=2, incorrect=1, accuracy=2 / 3),
            "day": _bucket(),  # empty
        },
    )
    block = serialize_historical_validation_summary(summary, window_days=90)

    assert "swing=" in block
    assert "day=" not in block, (
        "empty by_mode buckets must be skipped, not rendered as a calm-but-misleading "
        "'day=— (0 correct of 0 resolved)' line"
    )


def test_reply_authenticated_appends_block_when_summary_provided(
    monkeypatch: pytest.MonkeyPatch, service: AssistantChatService
) -> None:
    """The serialized HISTORICAL VALIDATION block must reach the system message for the
    authenticated path when the handler supplies a non-empty summary. This is the lock
    that connects the serializer to Claude's input."""
    captured: dict[str, object] = {}

    async def fake_claude(self, *, system, messages, max_tokens):  # type: ignore[no-untyped-def]
        captured["system"] = system
        return "Explained."

    monkeypatch.setattr(
        "stocvest.signals.assistant_chat.AssistantChatService._claude_chat_or_none",
        fake_claude,
    )

    asyncio.run(
        service.reply(
            messages=[{"role": "user", "content": "How has my track been doing?"}],
            page_context={"page": "dashboard/signal-validation"},
            user_profile=UserProfile(user_id="u-paid", subscription_plan="swing_pro"),
            historical_validation_summary=_summary(),
        )
    )
    system_text = captured.get("system")
    assert isinstance(system_text, str)
    # The prompt itself REFERENCES the `=== HISTORICAL VALIDATION ===` sentinel inside
    # the HISTORICAL VALIDATION CONTEXT section so the LLM knows what to pattern-match
    # on. To detect the *appended* block we look downstream of the PAGE CONTEXT tail
    # and check for the field-syntax wording (`window_days=`, `rows_examined=`) that
    # only the serializer emits.
    tail = system_text.split("=== PAGE CONTEXT ===", 1)[1]
    assert HISTORICAL_VALIDATION_BLOCK_HEADER in tail
    assert "window_days=90" in tail
    assert "overall=60.0% (3 correct of 5 resolved" in tail
    assert "rows_examined=5" in tail


def test_reply_authenticated_omits_block_when_summary_absent(
    monkeypatch: pytest.MonkeyPatch, service: AssistantChatService
) -> None:
    """When the handler passes `historical_validation_summary=None` (fetch failed or
    user has zero rows), the system message must NOT contain the sentinel header.
    Locks in the "no block means no comment" contract from the LLM side."""
    captured: dict[str, object] = {}

    async def fake_claude(self, *, system, messages, max_tokens):  # type: ignore[no-untyped-def]
        captured["system"] = system
        return "Explained."

    monkeypatch.setattr(
        "stocvest.signals.assistant_chat.AssistantChatService._claude_chat_or_none",
        fake_claude,
    )

    asyncio.run(
        service.reply(
            messages=[{"role": "user", "content": "What is STOCVEST?"}],
            page_context={"page": "dashboard"},
            user_profile=UserProfile(user_id="u-paid", subscription_plan="swing_pro"),
            historical_validation_summary=None,
        )
    )
    system_text = captured.get("system")
    assert isinstance(system_text, str)
    # The prompt itself references the sentinel string, so we look at the appended
    # tail (after PAGE CONTEXT) and check the field-syntax wording is absent. That is
    # the proof that the serializer did not emit a block.
    tail = system_text.split("=== PAGE CONTEXT ===", 1)[1]
    assert "window_days=" not in tail
    assert "rows_examined=" not in tail
    assert "overall=" not in tail


def test_reply_public_never_receives_historical_validation_block(
    monkeypatch: pytest.MonkeyPatch, service: AssistantChatService
) -> None:
    """The anonymous marketing path must never carry a HISTORICAL VALIDATION block —
    even though `reply_public` doesn't accept the kwarg by signature, this test also
    inspects the resulting system text so a future refactor that hardcodes the block
    into the public path gets caught immediately."""
    captured: dict[str, object] = {}

    async def fake_claude(self, *, system, messages, max_tokens):  # type: ignore[no-untyped-def]
        captured["system"] = system
        return "STOCVEST explanation."

    monkeypatch.setattr(
        "stocvest.signals.assistant_chat.AssistantChatService._claude_chat_or_none",
        fake_claude,
    )

    asyncio.run(
        service.reply_public(
            messages=[{"role": "user", "content": "What is STOCVEST?"}],
        )
    )
    system_text = captured.get("system")
    assert isinstance(system_text, str)
    # The prompt embeds the `=== HISTORICAL VALIDATION ===` sentinel as a reference for
    # the LLM's pattern-matching, so we look at the appended tail (post PAGE CONTEXT
    # marker) — the serializer's field-syntax wording must be entirely absent for the
    # public path because anonymous visitors must never see per-user numbers.
    tail = system_text.split("=== PAGE CONTEXT ===", 1)[1]
    assert "window_days=" not in tail
    assert "rows_examined=" not in tail
    assert "overall=" not in tail
    # Belt-and-suspenders: the public path must also not honor the kwarg if a future
    # refactor accidentally adds it. The signature lock-in is in
    # test_reply_public_does_not_accept_page_context_parameter (same shape).
    with pytest.raises(TypeError):
        asyncio.run(
            service.reply_public(  # type: ignore[call-arg]
                messages=[{"role": "user", "content": "hi"}],
                historical_validation_summary=_summary(),
            )
        )


def test_serialize_historical_validation_handles_no_neutrals_cleanly() -> None:
    """When `neutral == 0`, the overall line still emits the count (it's an absolute
    transparency figure, not a conditional one). Locks in the count-style format so
    a refactor that "tidies" the line by hiding zeros gets caught."""
    summary = _summary(
        rows_examined=5,
        overall=_bucket(total=5, correct=4, incorrect=1, neutral=0, accuracy=0.8),
    )
    block = serialize_historical_validation_summary(summary, window_days=90)
    assert "overall=80.0% (4 correct of 5 resolved; 0 neutral; 5 total)" in block
    # Numeric sanity — the accuracy is exactly 0.8 and renders as "80.0%".
    assert not math.isnan(summary.overall.accuracy)
