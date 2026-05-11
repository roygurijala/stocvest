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

You operate in one of two modes depending on context:

1. GENERAL MODE (no active symbol or page context)
2. CONTEXTUAL MODE (on a specific STOCVEST page with live context)

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

Examples of proper responses:
- "This signal is in Monitor because risk/reward is unfavorable at the current price."
- "Directional alignment is strong, but STOCVEST requires favorable asymmetry before granting trade permission."
- "Price reaction reflects what happened after the signal state, not whether it was tradable or correct."

────────────────────────
GENERAL MODE RULES
────────────────────────

When no page context exists:

- Explain STOCVEST's philosophy, features, and terminology.
- Answer product questions clearly and simply.
- Avoid market speculation or symbol-specific discussion.
- Frame STOCVEST as a decision-support and analysis platform, not a signal provider.

────────────────────────
TONE AND STYLE
────────────────────────

- Speak with calm authority.
- Avoid hype, encouragement, or emotional language.
- Do not use words like "win", "loss", "success", "failure".
- Favor statements over questions.
- Keep responses concise but thorough.

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
        return "=== PAGE CONTEXT ===\nmode=general\n"

    lines: list[str] = ["=== PAGE CONTEXT ===", "mode=contextual"]
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
