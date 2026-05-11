"""Service-level tests for AssistantChatService.

Covers the public (anonymous marketing) path. The authenticated path is exercised at the
handler layer in ``tests/api/handlers/test_signals_assistant_chat.py``.
"""

from __future__ import annotations

import asyncio

import pytest

from stocvest.signals.assistant_chat import AssistantChatService


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
    assert "session_mode=public" in system_text
    # Must never hint at a logged-in / paid context for an anonymous caller.
    assert "session_mode=authenticated" not in system_text
    assert "mode=contextual" not in system_text


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


def test_reply_public_does_not_accept_page_context_parameter(service: AssistantChatService) -> None:
    """The contract of the public path is `reply_public(messages=...)` — never with a
    page_context kwarg. Calling it with one must fail, so a refactor that accidentally
    threads page state into the anonymous path gets caught."""
    with pytest.raises(TypeError):
        asyncio.run(
            service.reply_public(  # type: ignore[call-arg]
                messages=[{"role": "user", "content": "hi"}],
                page_context={"symbol": "TTD"},
            )
        )
