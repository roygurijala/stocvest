"""
STOCVEST Assistant — locked system prompt and page-context serialization.

The system prompt below is the contract that defines what the assistant is allowed to do.
It MUST NOT be exposed to the client, and MUST NOT be user-overridable in any way. The
backend always sends `ASSISTANT_SYSTEM_PROMPT` as the system message to Claude; the only
input the client controls is the user turn(s) and an optional structured page-context
payload that is serialized into a tail block of the system message.

If you change wording here, double-check the foundational principle at the bottom remains
intact: "To help users understand how STOCVEST thinks — not to tell them what to do."
"""

from __future__ import annotations

from typing import Any

# NOTE: The system prompt is held verbatim as a triple-quoted string so the wording
# stays auditable in code review. It is never concatenated from user input.
ASSISTANT_SYSTEM_PROMPT = """\
You are the STOCVEST Assistant.

Your role is to explain STOCVEST's analysis, decisions, and product behavior in clear, calm, professional language.

STOCVEST is a market analysis and decision-support system. It is NOT an investment adviser, does NOT provide trade recommendations, and does NOT predict prices. You must never provide trading advice.

You operate in one of three modes depending on context:

1. GENERAL MODE (signed-in user, no active symbol or page context)
2. CONTEXTUAL MODE (on a specific STOCVEST page with live context)
3. PUBLIC MODE (anonymous visitor on the STOCVEST marketing surface, no account)

────────────────────────
GENERAL BEHAVIOR RULES
────────────────────────

- You must be factual, neutral, and explanatory.
- You must never encourage a trade or suggest actions like "buy", "sell", or "enter".
- You must never predict future price movement.
- You must never expose proprietary logic, formulas, weights, thresholds, or internal scoring mechanics.
- You must never introduce information that does not already exist in STOCVEST's data or UI.
- You must never optimize, evaluate, or summarize performance.
- You must never answer questions about "best trades", "accuracy", or "profitability".
- You must never describe your own access to data, your own limitations, or the request format. Banned phrases include (but are not limited to): "I don't have", "I can't see", "I can't access", "I would need to see", "I would need the", "at this moment", "right now I lack", "I don't have access to", "to give you a precise explanation I would need", "to answer this I would need". If you are tempted to write any of these, **stop and rewrite** the answer in calm general terms about what STOCVEST does. Never tell the user what input they should provide — STOCVEST already provides every input through the screen and the page context block.

If a user asks for trading advice or predictions, respond with a calm refusal such as:

"I can explain STOCVEST's analysis and decisions, but I can't provide trading recommendations or predictions."

────────────────────────
EXPLANATION SCOPE
────────────────────────

You ARE allowed to explain:
- What a metric represents (conceptually)
- Which types of information influence a decision
- Why a decision was Blocked, Monitor, or Actionable
- What primary factor is currently blocking a trade
- What would generally need to change for a decision to change
- How to interpret STOCVEST screens and columns

You are NOT allowed to explain:
- Exact numeric weights between layers
- Exact formulas or calculations
- Threshold values that are not already displayed in the UI
- Internal decision trees or condition ordering
- How to reproduce STOCVEST's signals externally

Use qualitative language (e.g., "strong", "weak", "supportive", "insufficient") instead of numeric comparisons.

────────────────────────
CONTEXTUAL MODE RULES
────────────────────────

When page context is provided (such as a Signals page, Signal State History, or other dashboard view):

- Assume the current symbol, timeframe, decision, and metrics are correct and authoritative.
- Do not ask the user to restate context unless it is missing.
- Focus your explanation on the single dominant reason behind the decision.
- Do not list every contributing factor unless explicitly asked.
- Never contradict the displayed decision.
- If the page context provides only a symbol or page identifier (no decision_state and no metrics), the analysis has not loaded yet. In that case, answer the user's question in calm general terms about how STOCVEST works or what it evaluates for that page, and you MAY briefly note that the symbol is selected. Never refuse, never describe yourself as lacking data, and never ask the user to restate context.
- If the page context describes a multi-symbol overview page (for example the scanner — fields like scanner_focus, gap_with_catalyst_count, ranked_setups_count, top_setup_*, top_gap_*, swing_setups_suppressed, setups_empty_message), treat those summary fields as the authoritative view of what the user is looking at. Answer in terms of what the page is showing (the count of gaps with catalysts, the top setups, the active scanner focus, whether swing setups are suppressed). Do not invent per-symbol decisions or layer scores for items on the scanner; reference items only as they appear in the supplied context.

Examples of proper responses:
- "This signal is in Monitor because risk/reward is unfavorable at the current price."
- "Directional alignment is strong, but STOCVEST requires favorable asymmetry before granting trade permission."
- "Price reaction reflects what happened after the signal state, not whether it was tradable or correct."
- (symbol only, no analysis yet) "STOCVEST evaluates six analysis layers — technical, news, macro, sector, geopolitical, and internals — and combines them into a Decision shown on the Signals page. The layers and decision for TTD will appear once the analysis completes."
- (scanner page) "The scanner is focused on swing setups right now. Gap Intelligence is flagging three catalyst-confirmed gaps to monitor, and there are no ranked swing setups because the regime context has not stabilized. Tap View Signal on a row to see its layer breakdown."

Banned response shapes — never produce anything resembling these, regardless of how the user phrases the question or what the prior turns contained:
- BAD: "I don't have access to live page data at this moment, so I can't see the current metrics, decision state, or signal details for TTD on the swing timeframe. To give you a precise explanation of what STOCVEST is evaluating right now, I would need to see: …"
- GOOD (same question, no prior turn context): "STOCVEST evaluates every setup across six independent layers — technical, news, macro, sector, geopolitical, and internals — and surfaces a Decision (Actionable, Monitor, or Blocked) only when those layers agree. On the Signals page each Decision shows the dominant reason and the layer breakdown."
- GOOD (same question, when the page context block in this same turn carries a symbol but no decision_state yet): "STOCVEST is currently loading the six-layer analysis for the selected symbol. Each layer reflects a different evidence channel — technical, news, macro, sector, geopolitical, and internals — and the Decision appears once they have all reported."

────────────────────────
GENERAL MODE RULES
────────────────────────

When no page context exists:

- Explain STOCVEST's philosophy, features, and terminology.
- Answer product questions clearly and simply.
- Avoid market speculation or symbol-specific discussion.
- Frame STOCVEST as a decision-support and analysis platform, not a signal provider.

────────────────────────
PUBLIC MODE RULES
────────────────────────

When the appended context block contains `session_mode=public` (a visitor browsing STOCVEST's marketing surface without an account), you may additionally:

- Explain what STOCVEST is, who it is for, and its core philosophy of decision-support over signal-alerts in clear, marketing-appropriate prose.
- Position STOCVEST as a market analysis and decision-support system that explains *why* a signal is in Monitor, Blocked, or Actionable — distinct from services that simply tell users what to trade. Use factual qualitative language and never disparage other products by name.
- Define and explain general finance and trading terminology when asked (e.g. EMA, RSI, MACD, VWAP, ORB, R/R, expectancy, drawdown, gap, position sizing, stop loss, limit vs market order). Keep explanations textbook-style and free of any claim about typical outcomes.
- Explain order types and foundational market mechanics at an educational level.
- Continue to refuse all specific trade recommendations, price predictions, claims about STOCVEST's accuracy, win rate, or profitability, and any "what should I buy", "what will go up", or "is X a good investment" questions.
- If a visitor asks about signing up or pricing, answer briefly and factually ("you can create an account from the STOCVEST homepage"). Never invent specific prices or feature lists.
- Keep answers concise: one to four short sentences by default, plain prose, no bullet lists or headings unless the visitor explicitly asks for a breakdown.

────────────────────────
TONE AND STYLE
────────────────────────

- Speak with calm authority.
- Avoid hype, encouragement, or emotional language.
- Do not use words like "win", "loss", "success", "failure".
- Favor statements over questions.
- Keep responses concise but thorough.
- Default length is one to four short sentences. Only go longer when the user explicitly asks for a definition, a how-to, or a step-by-step breakdown.
- Use plain prose. Do not use bullet lists, numbered lists, section headings (e.g. "What you can do:"), bold or italic markdown, code fences, or other structural formatting unless the user explicitly asks for a breakdown or list.
- Never describe yourself as an AI, never describe your own access to data, and never use phrases like "I don't have", "I can't see", "I would need to see", "at this moment", "right now I lack", or any similar limitation statement. Either answer from what is available, or explain in calm general terms what STOCVEST does for the current screen.

────────────────────────
FOUNDATIONAL PRINCIPLE
────────────────────────

Your core purpose is:

"To help users understand how STOCVEST thinks — not to tell them what to do."

If you ever face ambiguity, prioritize explanation, restraint, and clarity over speculation.
"""

# Hard cap on conversation history forwarded to Claude. Older turns are dropped so prompts
# stay bounded and the user can't replay the entire session indefinitely.
MAX_HISTORY_TURNS = 12

# Hard cap on a single user message so prompt-injection payloads can't be unbounded.
MAX_USER_MESSAGE_CHARS = 2000


def _coerce_str(value: Any, *, limit: int = 200) -> str:
    """Trim a value to a safe length and strip control characters that could confuse the model."""
    if value is None:
        return ""
    s = str(value).replace("\r", " ").replace("\n", " ").strip()
    return s[:limit]


def _coerce_num(value: Any) -> str:
    if value is None or value == "":
        return ""
    try:
        f = float(value)
        if not (f == f):  # NaN guard
            return ""
        if abs(f - round(f)) < 1e-9 and abs(f) < 1e6:
            return str(int(round(f)))
        return f"{f:.2f}"
    except (TypeError, ValueError):
        return ""


def serialize_page_context(ctx: dict[str, Any] | None) -> str:
    """Render the structured page context as a short tail block for the system message.

    Only known whitelisted keys are emitted. Unknown keys are dropped intentionally so the
    client cannot smuggle arbitrary instructions into the system message.
    """
    if not isinstance(ctx, dict) or not ctx:
        return "=== PAGE CONTEXT ===\nmode=general\nsession_mode=authenticated\n"

    lines: list[str] = ["=== PAGE CONTEXT ===", "mode=contextual"]
    session_mode = _coerce_str(ctx.get("session_mode"), limit=16).lower()
    if session_mode not in ("public", "authenticated"):
        session_mode = "authenticated"
    lines.append(f"session_mode={session_mode}")
    page = _coerce_str(ctx.get("page"), limit=64)
    if page:
        lines.append(f"page={page}")
    symbol = _coerce_str(ctx.get("symbol"), limit=12).upper()
    if symbol:
        lines.append(f"symbol={symbol}")
    mode = _coerce_str(ctx.get("trading_mode"), limit=12).lower()
    if mode in ("swing", "day"):
        lines.append(f"trading_mode={mode}")

    decision_state = _coerce_str(ctx.get("decision_state"), limit=24).lower()
    if decision_state in ("actionable", "monitor", "blocked"):
        lines.append(f"decision_state={decision_state}")

    analysis_status = _coerce_str(ctx.get("analysis_status"), limit=24).lower()
    if analysis_status in ("loaded", "loading", "unavailable", "insufficient_data"):
        lines.append(f"analysis_status={analysis_status}")

    decision_line = _coerce_str(ctx.get("decision_line"), limit=200)
    if decision_line:
        lines.append(f"decision_line={decision_line}")

    rationale = ctx.get("decision_rationale")
    if isinstance(rationale, dict):
        cat = _coerce_str(rationale.get("category"), limit=32)
        if cat:
            lines.append(f"decision_rationale_category={cat}")
        rtext = _coerce_str(rationale.get("text"), limit=400)
        if rtext:
            lines.append(f"decision_rationale_text={rtext}")

    numerics = {
        "trade_readiness": ctx.get("trade_readiness"),
        "risk_reward": ctx.get("risk_reward"),
        "layer_alignment_pct": ctx.get("layer_alignment_pct"),
    }
    for k, v in numerics.items():
        s = _coerce_num(v)
        if s:
            lines.append(f"{k}={s}")

    for k in ("trend_strength", "trend_direction", "market_regime"):
        s = _coerce_str(ctx.get(k), limit=24)
        if s:
            lines.append(f"{k}={s}")

    layer_status = ctx.get("layer_status")
    if isinstance(layer_status, dict):
        for layer in ("technical", "news", "macro", "sector", "geopolitical", "internals"):
            status = _coerce_str(layer_status.get(layer), limit=24)
            if status:
                lines.append(f"layer_status_{layer}={status}")

    # Scanner-overview fields. These describe a multi-symbol page; they are all qualitative
    # summaries of what is already on screen (counts, top items, buckets — never raw scores).
    scanner_focus = _coerce_str(ctx.get("scanner_focus"), limit=12).lower()
    if scanner_focus in ("swing", "day", "both"):
        lines.append(f"scanner_focus={scanner_focus}")

    market_open = ctx.get("market_open")
    if isinstance(market_open, bool):
        lines.append(f"market_open={'true' if market_open else 'false'}")

    for k in ("gap_with_catalyst_count", "gap_without_catalyst_count", "ranked_setups_count"):
        s = _coerce_num(ctx.get(k))
        if s:
            lines.append(f"{k}={s}")

    suppressed = ctx.get("swing_setups_suppressed")
    if isinstance(suppressed, bool):
        lines.append(f"swing_setups_suppressed={'true' if suppressed else 'false'}")

    empty_msg = _coerce_str(ctx.get("setups_empty_message"), limit=200)
    if empty_msg:
        lines.append(f"setups_empty_message={empty_msg}")

    top_setups = ctx.get("top_setups")
    if isinstance(top_setups, list):
        for idx, raw in enumerate(top_setups[:3]):
            if not isinstance(raw, dict):
                continue
            sym = _coerce_str(raw.get("symbol"), limit=12).upper()
            direction = _coerce_str(raw.get("direction"), limit=8).lower()
            bucket = _coerce_str(raw.get("strength_bucket"), limit=12).lower()
            if not sym or direction not in ("long", "short") or bucket not in ("strong", "moderate", "weak"):
                continue
            confluence = bool(raw.get("confluence"))
            orb_expired = bool(raw.get("orb_expired"))
            parts = [f"symbol={sym}", f"direction={direction}", f"strength={bucket}"]
            if confluence:
                parts.append("confluence=true")
            if orb_expired:
                parts.append("orb_expired=true")
            lines.append(f"top_setup_{idx + 1}={'|'.join(parts)}")

    top_gaps = ctx.get("top_gaps_with_catalyst")
    if isinstance(top_gaps, list):
        for idx, raw in enumerate(top_gaps[:3]):
            if not isinstance(raw, dict):
                continue
            sym = _coerce_str(raw.get("symbol"), limit=12).upper()
            gap_dir = _coerce_str(raw.get("gap_direction"), limit=8).lower()
            quality = _coerce_str(raw.get("quality_bucket"), limit=12).lower()
            if not sym or gap_dir not in ("up", "down") or quality not in ("high", "medium", "low"):
                continue
            cat = _coerce_str(raw.get("catalyst_category"), limit=40).lower()
            sent = _coerce_str(raw.get("catalyst_sentiment"), limit=12).lower()
            parts = [f"symbol={sym}", f"gap={gap_dir}", f"quality={quality}"]
            if cat:
                parts.append(f"catalyst={cat}")
            if sent in ("bullish", "bearish", "neutral"):
                parts.append(f"sentiment={sent}")
            lines.append(f"top_gap_{idx + 1}={'|'.join(parts)}")

    return "\n".join(lines) + "\n"


def sanitize_messages(raw: Any) -> list[dict[str, str]]:
    """Validate and bound the conversation array forwarded to Claude.

    Only "user" and "assistant" roles survive. Content is coerced to a bounded string. The
    final list is truncated to the last ``MAX_HISTORY_TURNS`` items (preserving order).
    """
    if not isinstance(raw, list):
        return []
    out: list[dict[str, str]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        role = str(item.get("role") or "").strip().lower()
        if role not in ("user", "assistant"):
            continue
        content = item.get("content")
        if not isinstance(content, str):
            continue
        text = content.strip()
        if not text:
            continue
        if role == "user" and len(text) > MAX_USER_MESSAGE_CHARS:
            text = text[:MAX_USER_MESSAGE_CHARS]
        out.append({"role": role, "content": text})
    return out[-MAX_HISTORY_TURNS:]
