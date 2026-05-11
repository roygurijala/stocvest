"""
STOCVEST Assistant chat service.

Wraps the Anthropic Messages API with the locked STOCVEST Assistant system prompt and a
serialized page-context tail block. Free users (no ``has_ai_explanations``) receive a
calm deterministic response that explains the assistant is a paid feature; paid users
get a Claude-generated answer constrained by the system prompt.

Design notes:
* The system prompt is loaded from ``assistant_prompts.ASSISTANT_SYSTEM_PROMPT`` and is
  never composed from client input. Only the page-context block is data-driven, and that
  block is built from a whitelist (see ``serialize_page_context``).
* No conversations are cached. Each turn is unique by user content; caching would risk
  cross-user leakage and would not save tokens meaningfully.
* All Anthropic credentials are read the same way as ``AIExplanationService`` so deploy
  config (Secrets Manager / env) stays consistent.
"""

from __future__ import annotations

import asyncio
import json
import os
from dataclasses import dataclass
from typing import Any, Literal

import httpx

from stocvest.data.models import UserProfile
from stocvest.signals.assistant_prompts import (
    ASSISTANT_SYSTEM_PROMPT,
    sanitize_messages,
    serialize_page_context,
)
from stocvest.signals.geopolitical_scanner import ANTHROPIC_API_URL, ANTHROPIC_VERSION
from stocvest.utils.api_rate_limits import await_claude_api_slot
from stocvest.utils.config import AI_MODEL_FAST, get_settings
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

AssistantSource = Literal["ai", "deterministic"]
AssistantMode = Literal["general", "contextual"]


@dataclass(frozen=True)
class AssistantChatResult:
    text: str
    source: AssistantSource
    mode: AssistantMode
    upgrade_available: bool


_DETERMINISTIC_GENERAL_REPLY = (
    "I'm the STOCVEST Assistant. I explain STOCVEST's analysis, decisions, and product "
    "behavior — what a metric means, why a signal is in Monitor or Blocked, or how to read "
    "a screen. I do not provide trading advice or price predictions. "
    "Conversational answers tailored to your screen are part of Swing Pro."
)

_DETERMINISTIC_CONTEXTUAL_REPLY = (
    "Conversational explanations of your current screen are a Swing Pro feature. "
    "STOCVEST still shows the dominant reason behind every Decision under the Trade "
    "Readiness card, and every column on the Signal State History view has a tooltip "
    "describing what it represents and what it is not."
)

_DETERMINISTIC_PUBLIC_REPLY = (
    "I'm the STOCVEST Assistant. STOCVEST is a market analysis and decision-support "
    "system: it explains why a signal is in Monitor, Blocked, or Actionable rather than "
    "telling you what to trade. The explanation service is briefly unavailable; please "
    "try again in a moment."
)


class AssistantChatService:
    """Paid-only conversational explanations with a calm deterministic fallback for free users."""

    async def reply(
        self,
        *,
        messages: list[dict[str, str]],
        page_context: dict[str, Any] | None,
        user_profile: UserProfile,
    ) -> AssistantChatResult:
        clean = sanitize_messages(messages)
        # A user message MUST be present at the tail; otherwise the request is malformed.
        if not clean or clean[-1].get("role") != "user":
            return AssistantChatResult(
                text=(
                    "Ask a question about STOCVEST's analysis, a decision on your screen, "
                    "or what a column means and I'll explain."
                ),
                source="deterministic",
                mode=_mode_from_context(page_context),
                upgrade_available=not user_profile.has_ai_explanations,
            )

        mode: AssistantMode = _mode_from_context(page_context)

        if not user_profile.has_ai_explanations:
            text = _DETERMINISTIC_CONTEXTUAL_REPLY if mode == "contextual" else _DETERMINISTIC_GENERAL_REPLY
            return AssistantChatResult(
                text=text,
                source="deterministic",
                mode=mode,
                upgrade_available=True,
            )

        system_text = ASSISTANT_SYSTEM_PROMPT + "\n" + serialize_page_context(page_context)
        ai_text = await self._claude_chat_or_none(
            system=system_text,
            messages=clean,
            max_tokens=320,
        )
        if ai_text:
            return AssistantChatResult(
                text=ai_text.strip(),
                source="ai",
                mode=mode,
                upgrade_available=False,
            )

        return AssistantChatResult(
            text=(
                "I couldn't reach the explanation service just now. Please try again in a "
                "moment. STOCVEST's Decision line and column tooltips on screen always "
                "carry the authoritative reasoning."
            ),
            source="deterministic",
            mode=mode,
            upgrade_available=False,
        )

    async def reply_public(
        self,
        *,
        messages: list[dict[str, str]],
    ) -> AssistantChatResult:
        """Anonymous (unauthenticated) chat for the marketing surface.

        No page context is honored — anonymous visitors have no STOCVEST page state. The
        locked system prompt activates its PUBLIC MODE section via the appended
        ``session_mode=public`` marker so the LLM is free to explain general finance terms,
        STOCVEST's positioning, and product mechanics while continuing to refuse all
        trade recommendations, predictions, and accuracy / profitability claims.

        Claude is called directly (no paid-feature gate); the same rate limiter that
        protects authenticated paid calls also protects this path. If Claude is unreachable
        the visitor still gets a calm deterministic introduction so the surface never
        appears broken.
        """
        clean = sanitize_messages(messages)
        if not clean or clean[-1].get("role") != "user":
            return AssistantChatResult(
                text=(
                    "I'm the STOCVEST Assistant. Ask me what STOCVEST is, how it differs "
                    "from signal-alert services, or for an explanation of a finance term "
                    "like R/R, EMA, VWAP, or ORB and I'll explain."
                ),
                source="deterministic",
                mode="general",
                upgrade_available=True,
            )

        system_text = (
            ASSISTANT_SYSTEM_PROMPT
            + "\n=== PAGE CONTEXT ===\nmode=general\nsession_mode=public\n"
        )
        ai_text = await self._claude_chat_or_none(
            system=system_text,
            messages=clean,
            max_tokens=320,
        )
        if ai_text:
            return AssistantChatResult(
                text=ai_text.strip(),
                source="ai",
                mode="general",
                upgrade_available=True,
            )

        return AssistantChatResult(
            text=_DETERMINISTIC_PUBLIC_REPLY,
            source="deterministic",
            mode="general",
            upgrade_available=True,
        )

    async def _claude_chat_or_none(
        self,
        *,
        system: str,
        messages: list[dict[str, str]],
        max_tokens: int,
    ) -> str | None:
        settings = get_settings()
        api_key = (settings.anthropic_api_key or os.environ.get("ANTHROPIC_API_KEY") or "").strip()
        if not api_key:
            return None
        payload = {
            "model": AI_MODEL_FAST,
            "max_tokens": max_tokens,
            "temperature": 0,
            "system": system,
            "messages": messages,
        }
        headers = {
            "x-api-key": api_key,
            "anthropic-version": ANTHROPIC_VERSION,
            "content-type": "application/json",
        }
        try:
            await await_claude_api_slot()
            async with httpx.AsyncClient(timeout=20.0) as client:
                res = await client.post(ANTHROPIC_API_URL, headers=headers, json=payload)
            if res.status_code >= 400:
                _LOG.debug("assistant_chat claude http %s", res.status_code)
                return None
            body = res.json()
            blocks = body.get("content")
            if not isinstance(blocks, list) or not blocks:
                return None
            text = str(blocks[0].get("text") or "").strip()
            return text or None
        except (httpx.HTTPError, TypeError, KeyError, json.JSONDecodeError, asyncio.TimeoutError) as exc:
            _LOG.debug("assistant_chat claude skip: %s", type(exc).__name__)
            return None


def _mode_from_context(ctx: dict[str, Any] | None) -> AssistantMode:
    """Contextual mode requires at least a page, symbol, or decision_state on the page.

    A non-empty ``page`` identifier alone is sufficient — multi-symbol overview pages like
    the scanner have no single symbol or decision_state, but the page itself is real context
    the assistant should anchor on. The system prompt covers how to behave when only a page
    identifier is present.
    """
    if not isinstance(ctx, dict):
        return "general"
    page = str(ctx.get("page") or "").strip()
    sym = str(ctx.get("symbol") or "").strip()
    state = str(ctx.get("decision_state") or "").strip().lower()
    if page or sym or state in ("actionable", "monitor", "blocked"):
        return "contextual"
    return "general"
