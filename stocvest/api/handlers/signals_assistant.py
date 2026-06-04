"""STOCVEST Assistant chat handlers.

Split out of ``signals.py`` (which re-imports both handlers so the HTTP
dispatcher and existing call sites/tests keep their import paths). No behavior
change — the handler bodies are byte-identical to their previous form.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any

from stocvest.api.legal_copy import API_SIGNAL_DISCLAIMER
from stocvest.api.response import bad_request, ok, unauthorized
from stocvest.api.shared import build_request_context, parse_json_body
from stocvest.api.types import LambdaContext, LambdaEvent
from stocvest.api.services.historical_validation_service import HistoricalValidationService
from stocvest.api.services.signal_recorder import get_signal_recorder
from stocvest.api.services.user_profile_store import get_user_profile_store
from stocvest.signals.product_kpi import (
    PRODUCT_KPI_DEFAULT_WINDOW_DAYS,
    filter_product_kpi_cohort,
    summarize_product_kpi,
)
from stocvest.signals.historical_validation import validate_signal_history
from stocvest.api.services.assistant_citations import build_citations
from stocvest.api.services.assistant_discovery import (
    discovery_payload,
    fetch_discovery_context,
    serialize_discovery_context,
)
from stocvest.api.services.assistant_market_context import (
    fetch_market_pulse_context,
    serialize_market_pulse_context,
)
from stocvest.api.services.assistant_symbol_context import (
    build_symbol_chart,
    fetch_assistant_symbol_context,
)
from stocvest.api.services.assistant_watchlist_action import (
    execute_watchlist_add,
    execute_watchlist_remove,
)
from stocvest.api.services.symbol_resolver import resolve_company_to_symbol, resolve_symbol
from stocvest.api.services.assistant_watchlist_context import (
    fetch_watchlist_context,
    serialize_watchlist_context,
)
from stocvest.signals.assistant_chat import AssistantChatService
from stocvest.utils.intent_detector import (
    detect_explicit_desk,
    is_discovery_query,
    is_market_overview_query,
    is_mode_sensitive_query,
    is_trade_planning_question,
    is_watchlist_add_intent,
    is_watchlist_intelligence_query,
    is_watchlist_remove_intent,
)
from stocvest.utils.symbol_detector import (
    detect_symbol_from_messages,
    extract_action_symbol,
    extract_company_lookup_phrase,
)
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)


def assistant_chat_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    """POST /v1/signals/assistant/chat — STOCVEST Assistant conversational explanations.

    Requires authentication. The system prompt is locked server-side; clients only
    supply the conversation turns and an optional whitelisted page-context object.
    Paid users get a Claude-generated reply; free users get a deterministic message.
    """
    _ = context
    rc = build_request_context(event)
    if not rc.user_id:
        return unauthorized("Authenticated user is required.")
    try:
        body = parse_json_body(event)
    except (TypeError, ValueError, KeyError):
        return bad_request("Invalid JSON body.")
    if not isinstance(body, dict):
        return bad_request("Body must be a JSON object.")

    raw_messages = body.get("messages")
    raw_context = body.get("page_context")
    page_context = raw_context if isinstance(raw_context, dict) else None
    raw_image = body.get("attached_image")
    attached_image = (
        raw_image
        if isinstance(raw_image, dict)
        and isinstance(raw_image.get("data"), str)
        and isinstance(raw_image.get("media_type"), str)
        and raw_image["media_type"] in ("image/jpeg", "image/png", "image/webp", "image/gif")
        else None
    )

    profile = get_user_profile_store().get_profile(rc.user_id)

    # ── Watchlist action intent (A2) ──────────────────────────────────────────
    # Detect add/remove intents BEFORE calling Claude. These are clear actions,
    # not questions — we execute immediately and return a structured confirmation.
    raw_messages_list = raw_messages if isinstance(raw_messages, list) else []
    last_user_text_for_intent = ""
    for _m in reversed(raw_messages_list):
        if isinstance(_m, dict) and _m.get("role") == "user":
            last_user_text_for_intent = str(_m.get("content") or "")
            break

    if last_user_text_for_intent and profile.has_ai_explanations:
        # Explicit actions name the ticker directly, so trust the token after the
        # verb even when it collides with a blocklisted abbreviation (e.g. "PE").
        action_sym = extract_action_symbol(last_user_text_for_intent)
        if action_sym:
            if is_watchlist_add_intent(last_user_text_for_intent):
                # Validate the ticker against Polygon reference data BEFORE writing
                # it, so a typo never silently lands on the watchlist. We only block
                # on a definitive miss/delisting — transient failures fail open.
                resolution = asyncio.run(resolve_symbol(action_sym))
                if not resolution.valid:
                    return ok({
                        "text": resolution.reason or f'I couldn\'t verify the ticker "{action_sym}".',
                        "source": "deterministic",
                        "mode": "contextual",
                        "upgrade_available": False,
                        "disclaimer": API_SIGNAL_DISCLAIMER,
                        "navigate_to": None,
                        "action": {
                            "type": "watchlist_add",
                            "symbol": action_sym,
                            "company_name": resolution.name,
                            "success": False,
                            "message": resolution.reason
                            or f'I couldn\'t verify the ticker "{action_sym}".',
                        },
                    })
                wl_result = execute_watchlist_add(
                    rc.user_id, action_sym, company_name=resolution.name
                )
                return ok({
                    "text": wl_result.message,
                    "source": "deterministic",
                    "mode": "contextual",
                    "upgrade_available": False,
                    "disclaimer": API_SIGNAL_DISCLAIMER,
                    "navigate_to": None,
                    "action": {
                        "type": wl_result.action_type,
                        "symbol": wl_result.symbol,
                        "company_name": wl_result.company_name,
                        "success": wl_result.success,
                        "message": wl_result.message,
                    },
                })
            if is_watchlist_remove_intent(last_user_text_for_intent):
                wl_result = execute_watchlist_remove(rc.user_id, action_sym)
                return ok({
                    "text": wl_result.message,
                    "source": "deterministic",
                    "mode": "contextual",
                    "upgrade_available": False,
                    "disclaimer": API_SIGNAL_DISCLAIMER,
                    "navigate_to": None,
                    "action": {
                        "type": wl_result.action_type,
                        "symbol": wl_result.symbol,
                        "company_name": wl_result.company_name,
                        "success": wl_result.success,
                        "message": wl_result.message,
                    },
                })

    svc = AssistantChatService()

    # Product KPI cohort for the user (trailing 90d, 1d) — same definition as /performance.
    historical_summary = None
    product_kpi_summary = None
    try:
        validation_service = HistoricalValidationService(get_signal_recorder())
        _now = datetime.now(timezone.utc)
        _from = _now - timedelta(days=PRODUCT_KPI_DEFAULT_WINDOW_DAYS)
        rows = validation_service._fetch(
            user_id=rc.user_id,
            from_at=_from,
            to_at=_now,
            mode=None,
            symbol=None,
        )
        cohort = filter_product_kpi_cohort(rows)
        historical_summary = validate_signal_history(cohort, horizon="1d")
        product_kpi_summary = summarize_product_kpi(
            cohort,
            horizon="1d",
            from_at=_from,
            to_at=_now,
        )
    except Exception:  # noqa: BLE001 — never let a fetch failure break the chat reply
        _LOG.exception("assistant_chat: failed to fetch historical validation summary")
        historical_summary = None
        product_kpi_summary = None

    # ── Light personalization: resolve the user's trading desk ───────────────
    # Priority: explicit screen mode > explicit desk language in the message >
    # stored preference > default (day). A newly stated preference is persisted so
    # future desk-ambiguous questions inherit it without re-asking.
    page_mode: str | None = None
    if page_context and isinstance(page_context.get("trading_mode"), str):
        _pm = page_context["trading_mode"].strip().lower()
        page_mode = _pm if _pm in ("swing", "day") else None

    explicit_desk = (
        detect_explicit_desk(last_user_text_for_intent) if profile.has_ai_explanations else None
    )
    if (
        explicit_desk
        and profile.has_ai_explanations
        and explicit_desk != (profile.assistant_preferred_desk or "")
    ):
        try:
            updated = profile.model_copy(update={"assistant_preferred_desk": explicit_desk})
            get_user_profile_store().put_profile(updated)
            profile = updated
        except Exception:  # noqa: BLE001 — preference persistence must never break chat
            _LOG.warning("assistant_chat: failed to persist preferred desk", exc_info=True)

    stored_desk = (
        profile.assistant_preferred_desk
        if profile.assistant_preferred_desk in ("swing", "day")
        else None
    )
    resolved_desk = page_mode or explicit_desk or stored_desk or "day"

    # ── Discovery intent (A3) ────────────────────────────────────────────────
    # When the user asks "what's moving today?" / "any momentum stocks?", pull
    # from the cached desk results and inject them as context. No new scan.
    discovery_block = ""
    discovery_payload_out: dict | None = None
    if profile.has_ai_explanations and is_discovery_query(last_user_text_for_intent):
        try:
            disc = fetch_discovery_context(resolved_desk)
            discovery_block = serialize_discovery_context(disc)
            discovery_payload_out = discovery_payload(disc)
            if not disc.has_data:
                # No cached data — add a soft note so Claude routes correctly.
                discovery_block = (
                    "=== SCANNER DISCOVERY ===\n"
                    "source=no_cached_results\n"
                    "note=No scanner results are cached right now. Suggest the user open the Scanner page for a fresh scan.\n"
                )
        except Exception:  # noqa: BLE001
            discovery_block = ""

    # ── Market overview intent ───────────────────────────────────────────────
    # Broad market questions ("how is the stock market doing today?") should
    # get concrete pulse context from the cached market snapshot.
    market_block = ""
    if profile.has_ai_explanations and is_market_overview_query(last_user_text_for_intent):
        try:
            market_ctx = fetch_market_pulse_context()
            market_block = serialize_market_pulse_context(market_ctx)
            if not market_ctx.has_data:
                market_block = (
                    "=== MARKET PULSE CONTEXT ===\n"
                    "source=no_cached_market_pulse\n"
                    "note=No market pulse cache is available right now. Use a cautious, non-specific summary and suggest checking Dashboard pulse cards.\n"
                )
        except Exception:  # noqa: BLE001
            market_block = ""

    # ── Watchlist intelligence intent ────────────────────────────────────────
    # "How is my watchlist doing today?" / "best opportunities from my watchlist"
    # are answered from cached maturation data (no expensive recompute).
    watchlist_block = ""
    if profile.has_ai_explanations and is_watchlist_intelligence_query(last_user_text_for_intent):
        try:
            wl_ctx = fetch_watchlist_context(rc.user_id, resolved_desk)  # type: ignore[arg-type]
            watchlist_block = serialize_watchlist_context(wl_ctx)
            if not watchlist_block:
                watchlist_block = (
                    "=== WATCHLIST CONTEXT ===\n"
                    "source=no_cached_watchlist_data\n"
                    "note=No watchlist maturation data is cached right now. Suggest the user open the "
                    "Watchlists page so STOCVEST can evaluate their symbols.\n"
                )
        except Exception:  # noqa: BLE001
            watchlist_block = ""

    # Detect a ticker symbol from the conversation and pre-fetch live market
    # data so the assistant can answer factual questions (e.g. "why is MRVL
    # up?") with real data rather than generic explanations.
    symbol_context = None
    detected_sym: str | None = None
    if profile.has_ai_explanations:
        try:
            messages_list = raw_messages if isinstance(raw_messages, list) else []
            detected_sym = detect_symbol_from_messages(messages_list)
            # Company-name lookup: "how did broadcom do today?" carries no ticker
            # token, so resolve the named company to a ticker via a reference
            # search (guarded by a name match) — but only for single-instrument
            # questions, never for market-overview / watchlist intents.
            #
            # This MUST run before the page-context fallback: a company the user
            # explicitly names in their message always wins over whatever symbol
            # happens to be loaded on the current page. Otherwise asking about
            # "broadcom" while a different ticker is open would silently answer
            # about that page symbol and then refuse ("no data for Broadcom").
            if (
                not detected_sym
                and not is_market_overview_query(last_user_text_for_intent)
                and not is_watchlist_intelligence_query(last_user_text_for_intent)
            ):
                lookup_phrase = extract_company_lookup_phrase(last_user_text_for_intent)
                if lookup_phrase:
                    detected_sym = asyncio.run(resolve_company_to_symbol(lookup_phrase))
            # Last resort: the symbol already loaded on the current page. Only used
            # when the user named neither a ticker nor a company in their message
            # (e.g. "how is it doing today?" while viewing a symbol).
            if not detected_sym and page_context and isinstance(page_context.get("symbol"), str):
                detected_sym = page_context["symbol"].strip().upper() or None
            if detected_sym:
                symbol_context = asyncio.run(fetch_assistant_symbol_context(detected_sym))
        except Exception:  # noqa: BLE001
            _LOG.exception("assistant_chat: symbol context fetch failed — continuing without it")
            symbol_context = None

    # Deterministic chart payload (intraday sparkline) built from the live
    # snapshot/bars so a "how is NVDA doing today?" answer can ship a mini-chart.
    chart_payload: dict | None = None
    try:
        if symbol_context is not None:
            chart_payload = build_symbol_chart(symbol_context)
    except Exception:  # noqa: BLE001
        chart_payload = None

    # Source-citation chips — the underlying news/Benzinga items behind a
    # "why is X moving?" synthesis, so the user can verify the sources.
    citations_out: list[dict] | None = None
    try:
        citations_out = build_citations(symbol_context)
    except Exception:  # noqa: BLE001
        citations_out = None

    # Clarifying-question chips — when a desk-ambiguous discovery/opportunity/
    # trade-planning question arrives with no screen mode, no explicit desk
    # language, and no stored preference, offer quick swing/day refinements.
    clarify_out: dict | None = None
    if (
        profile.has_ai_explanations
        and is_mode_sensitive_query(last_user_text_for_intent)
        and not page_mode
        and not explicit_desk
        and not stored_desk
    ):
        clarify_out = {
            "prompt": "Which desk should I focus on? STOCVEST gates swing and day independently.",
            "options": [
                {"label": "Swing (multi-day)", "send": "Focus on swing (multi-day) setups"},
                {"label": "Day (intraday)", "send": "Focus on day (intraday) setups"},
            ],
        }

    # Preference context — tells Claude to answer for the user's usual desk when a
    # question is desk-ambiguous (and they have not overridden it this turn).
    preference_block = ""
    if stored_desk and not explicit_desk and not page_mode:
        preference_block = (
            "=== USER PREFERENCE ===\n"
            f"preferred_desk={stored_desk}\n"
            "note=The user usually focuses on this desk. For a desk-ambiguous question, answer for "
            "this desk and briefly note they can ask about the other.\n"
        )

    # Detect trade-planning intent to pre-attach navigate_to deep-link.
    # Checked before calling Claude so the result carries it even on the
    # deterministic (free-tier) path.
    navigate_to: str | None = None
    try:
        last_user_text = ""
        if isinstance(raw_messages, list):
            for m in reversed(raw_messages):
                if isinstance(m, dict) and m.get("role") == "user":
                    last_user_text = str(m.get("content") or "")
                    break
        if detected_sym and is_trade_planning_question(last_user_text):
            navigate_to = f"/dashboard/signals?symbol={detected_sym}"
    except Exception:  # noqa: BLE001
        navigate_to = None

    try:
        result = asyncio.run(
            svc.reply(
                messages=raw_messages if isinstance(raw_messages, list) else [],
                page_context=page_context,
                user_profile=profile,
                historical_validation_summary=historical_summary,
                product_kpi_summary=product_kpi_summary,
                symbol_context=symbol_context,
                attached_image=attached_image,
                discovery_context=discovery_block,
                market_context=market_block,
                watchlist_context=watchlist_block,
                preference_context=preference_block,
            )
        )
    except (TypeError, ValueError) as exc:
        return bad_request(f"Invalid assistant request: {exc}")

    # Strip the [OPEN_SIGNALS] marker Claude may have emitted — the
    # navigate_to field in the response is the authoritative signal.
    result_text = result.text.replace("[OPEN_SIGNALS]", "").strip()
    # If the prompt rule fired AND intent was detected, navigate_to is set.
    # If the prompt rule fired but intent wasn't pre-detected (edge case),
    # still honour the marker by using the detected_sym or page symbol.
    if "[OPEN_SIGNALS]" in result.text and not navigate_to and detected_sym:
        navigate_to = f"/dashboard/signals?symbol={detected_sym}"

    return ok(
        {
            "text": result_text,
            "source": result.source,
            "mode": result.mode,
            "upgrade_available": result.upgrade_available,
            "disclaimer": API_SIGNAL_DISCLAIMER,
            "navigate_to": navigate_to,
            "chart": chart_payload,
            "discovery": discovery_payload_out,
            "citations": citations_out,
            "clarify": clarify_out,
        }
    )


def public_assistant_chat_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    """POST /v1/public/assistant/chat — unauthenticated STOCVEST Assistant for marketing visitors.

    No JWT required. The locked system prompt's PUBLIC MODE section activates via the
    appended ``session_mode=public`` marker so anonymous visitors can ask what STOCVEST
    is, how it positions itself versus signal-alert services, and for explanations of
    finance terms — while the prompt continues to refuse all trade recommendations,
    price predictions, and accuracy claims.

    Only whitelisted ``marketing/*`` page ids in ``page_context`` are honored; symbol and
    decision fields are stripped server-side so tampered clients cannot impersonate an
    in-app Evidence card.
    """
    _ = context
    try:
        body = parse_json_body(event)
    except (TypeError, ValueError, KeyError):
        return bad_request("Invalid JSON body.")
    if not isinstance(body, dict):
        return bad_request("Body must be a JSON object.")

    from stocvest.signals.assistant_prompts import sanitize_public_page_context

    raw_messages = body.get("messages")
    raw_context = body.get("page_context")
    page_context = sanitize_public_page_context(raw_context if isinstance(raw_context, dict) else None)
    svc = AssistantChatService()
    try:
        result = asyncio.run(
            svc.reply_public(
                messages=raw_messages if isinstance(raw_messages, list) else [],
                page_context=page_context,
            )
        )
    except (TypeError, ValueError) as exc:
        return bad_request(f"Invalid assistant request: {exc}")

    return ok(
        {
            "text": result.text,
            "source": result.source,
            "mode": result.mode,
            "upgrade_available": result.upgrade_available,
            "disclaimer": API_SIGNAL_DISCLAIMER,
        }
    )
