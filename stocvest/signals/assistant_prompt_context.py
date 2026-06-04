"""STOCVEST Assistant — page-context serialization and message sanitization.

Split out of ``assistant_prompts.py`` (which now holds only the verbatim
system-prompt constant). Import paths are preserved: every public name here
is re-exported from ``stocvest.signals.assistant_prompts``.
"""

from __future__ import annotations

import re
from typing import Any


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


def _append_gap_summary_lines(
    lines: list[str],
    raw_list: Any,
    line_prefix: str,
    limit: int,
) -> None:
    """Emit qualitative gap rows (symbol, direction, quality, optional catalyst)."""
    if not isinstance(raw_list, list):
        return
    for idx, raw in enumerate(raw_list[:limit]):
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
        lines.append(f"{line_prefix}_{idx + 1}={'|'.join(parts)}")


def _serialize_dashboard_context_v1(lines: list[str], dc: dict[str, Any]) -> None:
    """Tier 1.C Phase 4 — nested dashboard_context version 1 block."""
    if dc.get("version") != 1:
        return
    lines.append("dashboard_context_version=1")

    reg = _coerce_str(dc.get("regime"), limit=24)
    if reg:
        lines.append(f"dashboard_regime={reg}")

    me = dc.get("market_environment")
    if isinstance(me, dict):
        tier = _coerce_str(me.get("tier"), limit=16).lower()
        if tier in ("normal", "elevated", "stressed", "crisis"):
            lines.append(f"market_environment_tier={tier}")
        headline = _coerce_str(me.get("headline"), limit=280)
        if headline:
            lines.append(f"market_environment_headline={headline}")
        vix = _coerce_num(me.get("vix_level"))
        if vix:
            lines.append(f"market_environment_vix={vix}")
        if me.get("new_swing_allowed") is False:
            lines.append("market_environment_new_swing_allowed=false")
        if me.get("new_day_allowed") is False:
            lines.append("market_environment_new_day_allowed=false")
        min_swing = _coerce_num(me.get("min_rr_swing"))
        if min_swing:
            lines.append(f"market_environment_min_rr_swing={min_swing}")
        min_day = _coerce_num(me.get("min_rr_day"))
        if min_day:
            lines.append(f"market_environment_min_rr_day={min_day}")

    disc = dc.get("discovery")
    if isinstance(disc, dict):
        lc = _coerce_num(disc.get("leader_count"))
        if lc:
            lines.append(f"discovery_leader_count={lc}")
        wc = _coerce_num(disc.get("with_catalyst_count"))
        if wc:
            lines.append(f"discovery_with_catalyst_count={wc}")
        prev = disc.get("preview_symbols")
        if isinstance(prev, list):
            syms = [_coerce_str(x, limit=12).upper() for x in prev[:5]]
            syms = [s for s in syms if s]
            if syms:
                lines.append(f"discovery_preview_symbols={','.join(syms)}")
        src = _coerce_str(disc.get("source"), limit=24).lower()
        if src in ("desk_cache", "movers_radar", "gap_fallback", "empty"):
            lines.append(f"discovery_source={src}")
        scanned = _coerce_num(disc.get("scanned_count"))
        if scanned:
            lines.append(f"discovery_scanned_count={scanned}")
        gen_at = _coerce_str(disc.get("generated_at"), limit=32)
        if gen_at:
            lines.append(f"discovery_generated_at={gen_at}")
        hot = disc.get("recently_hot")
        if isinstance(hot, list):
            hot_syms = [_coerce_str(x, limit=12).upper() for x in hot[:5]]
            hot_syms = [s for s in hot_syms if s]
            if hot_syms:
                lines.append(f"discovery_recently_hot={','.join(hot_syms)}")

    sess = dc.get("session_activity")
    if isinstance(sess, dict):
        sc = _coerce_num(sess.get("count"))
        if sc:
            lines.append(f"session_activity_count={sc}")
        syms = sess.get("symbols")
        if isinstance(syms, list):
            sym_list = [_coerce_str(x, limit=12).upper() for x in syms[:15]]
            sym_list = [s for s in sym_list if s]
            if sym_list:
                lines.append(f"session_activity_symbols={','.join(sym_list)}")
        prev = sess.get("preview_symbols")
        if isinstance(prev, list):
            prev_list = [_coerce_str(x, limit=12).upper() for x in prev[:8]]
            prev_list = [s for s in prev_list if s]
            if prev_list:
                lines.append(f"session_activity_preview_symbols={','.join(prev_list)}")
        ssrc = _coerce_str(sess.get("source"), limit=24).lower()
        if ssrc in ("desk_cache", "movers_radar", "gap_fallback", "empty"):
            lines.append(f"session_activity_source={ssrc}")
        note = _coerce_str(sess.get("note"), limit=200)
        if note:
            lines.append(f"session_activity_note={note}")

    uni = dc.get("universe")
    if isinstance(uni, dict):
        swing_n = _coerce_num(uni.get("swing_universe_symbol_count"))
        if swing_n:
            lines.append(f"universe_swing_symbol_count={swing_n}")
        gap_n = _coerce_num(uni.get("gap_snapshot_symbol_count"))
        if gap_n:
            lines.append(f"universe_gap_snapshot_count={gap_n}")

    macros = dc.get("macro_events")
    if isinstance(macros, list):
        for idx, raw in enumerate(macros[:5]):
            if not isinstance(raw, dict):
                continue
            sym = _coerce_str(raw.get("symbol"), limit=12).upper()
            date = _coerce_str(raw.get("report_date"), limit=12)
            rtime = _coerce_str(raw.get("report_time"), limit=24).lower()
            if not sym or not date:
                continue
            parts = [f"symbol={sym}", f"date={date}"]
            if rtime in ("before_market", "after_market", "during_market", "unknown"):
                parts.append(f"time={rtime}")
            lines.append(f"macro_event_{idx + 1}={'|'.join(parts)}")

    gis = dc.get("gap_intel_summary")
    if isinstance(gis, dict):
        glc = _coerce_num(gis.get("leader_count"))
        if glc is not None:
            lines.append(f"gap_intel_summary_leader_count={int(glc)}")
        gwc = _coerce_num(gis.get("with_catalyst_count"))
        if gwc is not None:
            lines.append(f"gap_intel_summary_with_catalyst_count={int(gwc)}")
        gwoc = _coerce_num(gis.get("without_catalyst_count"))
        if gwoc is not None:
            lines.append(f"gap_intel_summary_without_catalyst_count={int(gwoc)}")
        gprev = gis.get("preview_symbols")
        if isinstance(gprev, list):
            syms = [_coerce_str(x, limit=12).upper() for x in gprev[:8]]
            syms = [s for s in syms if s]
            if syms:
                lines.append(f"gap_intel_summary_preview_symbols={','.join(syms)}")
        empty_note = _coerce_str(gis.get("empty_note"), limit=220)
        if empty_note:
            lines.append(f"gap_intel_summary_empty_note={empty_note}")

    _append_gap_summary_lines(lines, dc.get("gap_leaders_detail"), "gap_leader", 10)


_PAGE_LABELS: dict[str, str] = {
    "signals/layers": "Signals (layers / evidence)",
    "dashboard/scanner": "Scanner",
    "dashboard": "Dashboard",
    "dashboard/watchlists": "Watchlists",
    "dashboard/performance": "Performance",
    "dashboard/setup-outcomes": "Setup outcomes",
}

_DECISION_STATE_LABELS: dict[str, str] = {
    "actionable": "Actionable — cleared to plan on the desk",
    "monitor": "Monitor only — wait and watch",
    "blocked": "Blocked — fails minimum desk gates",
}

_RATIONALE_CATEGORY_LABELS: dict[str, str] = {
    "data_insufficient": "Incomplete data for a confident read",
    "risk_reward": "Risk/reward below the desk minimum",
    "confirmation": "Layers don't fully agree on direction yet",
    "regime": "Macro or regime conflicts with direction",
    "readiness": "Setup not ready yet",
}

_LAYER_LABELS: dict[str, str] = {
    "technical": "Technical",
    "news": "News",
    "macro": "Macro",
    "sector": "Sector",
    "geopolitical": "Geopolitical",
    "internals": "Market internals",
}

_DESK_POSTURE_LABELS: dict[str, str] = {
    "active": "Active",
    "monitor": "Monitor",
    "suppressed": "Suppressed",
    "suppressed_session_closed": "Suppressed (session closed)",
    "suppressed_no_confirmation": "Suppressed (no intraday confirmation)",
    "suppressed_scanner_error": "Suppressed (scanner unavailable)",
}

# Tokens that must never appear in user-visible assistant replies.
_INTERNAL_TOKEN_RE = re.compile(
    r"\b(?:"
    r"decision_reinforcement_\d+|decision_rationale_(?:category|text)|"
    r"gap_intel_[a-z0-9_]+|layer_status_[a-z]+|dashboard_context_version|"
    r"discovery_[a-z_]+|gap_intel_summary_[a-z_]+|gap_leader_\d+|"
    r"macro_event_\d+|session_activity_[a-z_]+|"
    r"decision_state|analysis_status|scanner_focus|swing_desk_posture|day_desk_posture|"
    r"top_setup_\d+|top_gap_\d+"
    r")\b",
    re.IGNORECASE,
)

_CONTEXT_ASSIGNMENT_RE = re.compile(
    r"\b(?:decision_state|trading_mode|session_mode|analysis_status|page)=[^\s,;]+",
    re.IGNORECASE,
)

# Compliance / engineering phrases the model must not leave in user-visible replies.
_ASSISTANT_JARGON_REPLACEMENTS: tuple[tuple[re.Pattern[str], str], ...] = (
    (
        re.compile(
            r"risk/reward does not meet internal thresholds for structured scenario building",
            re.IGNORECASE,
        ),
        "the reward doesn't justify the risk for building a trade plan on the desk yet",
    ),
    (
        re.compile(r"internal thresholds for structured scenario building", re.IGNORECASE),
        "not ready to build a trade plan on the desk yet",
    ),
    (
        re.compile(r"structured scenario building", re.IGNORECASE),
        "building a trade plan on the desk",
    ),
    (
        re.compile(r"decisive across the six layers", re.IGNORECASE),
        "the layers don't fully agree yet",
    ),
    (
        re.compile(r"Daily and weekly timeframes diverge\.?", re.IGNORECASE),
        "Short-term and longer-term trends point different ways — that's a caution flag.",
    ),
    (
        re.compile(r"timeframes diverge", re.IGNORECASE),
        "short-term and longer-term trends point different ways",
    ),
)


def sanitize_assistant_user_reply(text: str) -> str:
    """Strip common internal field-name leaks from model output before returning to the client."""
    if not text or not text.strip():
        return text
    cleaned = _INTERNAL_TOKEN_RE.sub("", text)
    cleaned = _CONTEXT_ASSIGNMENT_RE.sub("", cleaned)
    for pattern, replacement in _ASSISTANT_JARGON_REPLACEMENTS:
        cleaned = pattern.sub(replacement, cleaned)
    cleaned = re.sub(r"[ \t]{2,}", " ", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


def serialize_page_context_plain_english(ctx: dict[str, Any]) -> str:
    """Readable summary of PAGE CONTEXT for the model — not for echoing verbatim to users."""
    if not isinstance(ctx, dict) or not ctx:
        return ""

    lines: list[str] = [
        "=== WHAT THE USER SEES (PLAIN ENGLISH — DO NOT QUOTE FIELD NAMES IN REPLIES) ===",
    ]

    page = _coerce_str(ctx.get("page"), limit=64)
    if page:
        lines.append(f"Screen: {_PAGE_LABELS.get(page, page.replace('/', ' / '))}")

    symbol = _coerce_str(ctx.get("symbol"), limit=12).upper()
    if symbol:
        lines.append(f"Symbol under discussion: {symbol}")

    mode = _coerce_str(ctx.get("trading_mode"), limit=12).lower()
    if mode == "swing":
        lines.append("Active desk: Swing (multi-day)")
    elif mode == "day":
        lines.append("Active desk: Day (intraday)")

    analysis_status = _coerce_str(ctx.get("analysis_status"), limit=24).lower()
    if analysis_status == "loading":
        lines.append("Analysis on screen: still loading")
    elif analysis_status in ("unavailable", "insufficient_data"):
        lines.append("Analysis on screen: not enough data to show a full decision")

    decision_state = _coerce_str(ctx.get("decision_state"), limit=24).lower()
    if decision_state in _DECISION_STATE_LABELS:
        lines.append(f"Decision: {_DECISION_STATE_LABELS[decision_state]}")

    decision_line = _coerce_str(ctx.get("decision_line"), limit=200)
    if decision_line:
        lines.append(f"Decision line on card: {decision_line}")

    rationale = ctx.get("decision_rationale")
    if isinstance(rationale, dict):
        cat = _coerce_str(rationale.get("category"), limit=32).lower()
        rtext = _coerce_str(rationale.get("text"), limit=400)
        if cat in _RATIONALE_CATEGORY_LABELS:
            lines.append(f"Main reason category: {_RATIONALE_CATEGORY_LABELS[cat]}")
        if rtext:
            lines.append(f"Main reason sentence: {rtext}")

    reinforcements = ctx.get("decision_reinforcements")
    if isinstance(reinforcements, list):
        for idx, raw_line in enumerate(reinforcements[:5]):
            line = _coerce_str(raw_line, limit=200)
            if line:
                lines.append(f"Also in play ({idx + 1}): {line}")

    for label_key, human_label in (
        ("setup_bias", "Setup bias"),
        ("alignment_display", "Layer alignment"),
        ("execution_readiness_label", "Execution readiness"),
        ("execution_hint", "Execution note"),
        ("maturation_label", "Watchlist maturation"),
        ("timeframe_alignment_label", "Timeframe alignment"),
        ("causal_narrative_summary", "Headline narrative"),
        ("causal_blocking_chain", "Blocking chain"),
    ):
        s = _coerce_str(ctx.get(label_key), limit=400 if label_key == "causal_narrative_summary" else 200)
        if s:
            lines.append(f"{human_label}: {s}")

    readiness = _coerce_num(ctx.get("trade_readiness"))
    if readiness:
        lines.append(f"Trade readiness score on screen: {readiness} (0–100 desk score)")

    rr = _coerce_num(ctx.get("risk_reward"))
    if rr:
        lines.append(f"Risk/reward on screen: {rr}:1")

    align_pct = _coerce_num(ctx.get("layer_alignment_pct"))
    if align_pct:
        lines.append(f"Layer agreement: about {align_pct}% of layers aligned")

    layer_status = ctx.get("layer_status")
    if isinstance(layer_status, dict):
        parts: list[str] = []
        for layer in ("technical", "news", "macro", "sector", "geopolitical", "internals"):
            status = _coerce_str(layer_status.get(layer), limit=24)
            if status:
                parts.append(f"{_LAYER_LABELS.get(layer, layer)}={status}")
        if parts:
            lines.append("Six layers: " + "; ".join(parts))

    swing_posture = _coerce_str(ctx.get("swing_desk_posture"), limit=32).lower()
    if swing_posture in _DESK_POSTURE_LABELS:
        lines.append(f"Swing desk posture: {_DESK_POSTURE_LABELS[swing_posture]}")

    day_posture = _coerce_str(ctx.get("day_desk_posture"), limit=48).lower()
    if day_posture in _DESK_POSTURE_LABELS:
        lines.append(f"Day desk posture: {_DESK_POSTURE_LABELS[day_posture]}")

    scanner_focus = _coerce_str(ctx.get("scanner_focus"), limit=12).lower()
    if scanner_focus == "both":
        lines.append("Scanner view: separate Swing and Day sections")
    elif scanner_focus in ("swing", "day"):
        lines.append(f"Scanner view: {scanner_focus} setups only")

    ranked = _coerce_num(ctx.get("ranked_setups_count"))
    if ranked:
        lines.append(f"Qualifying setups visible: {ranked}")

    gap_cat = _coerce_num(ctx.get("gap_with_catalyst_count"))
    if gap_cat:
        lines.append(f"Gaps with catalyst on screen: {gap_cat}")

    gap_intel = ctx.get("gap_intel")
    if isinstance(gap_intel, dict):
        ph = gap_intel.get("phase") if isinstance(gap_intel.get("phase"), dict) else {}
        phase_label = _coerce_str(ph.get("label"), limit=48)
        if phase_label:
            lines.append(f"Gap Intelligence session phase: {phase_label}")
        g = gap_intel.get("gap") if isinstance(gap_intel.get("gap"), dict) else {}
        gap_dir = _coerce_str(g.get("direction"), limit=12).upper()
        if gap_dir in ("UP", "DOWN"):
            lines.append(f"Gap direction: {'up' if gap_dir == 'UP' else 'down'}")

    if len(lines) <= 1:
        return ""
    return "\n".join(lines) + "\n"


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

    reinforcements = ctx.get("decision_reinforcements")
    if isinstance(reinforcements, list):
        for idx, raw_line in enumerate(reinforcements[:5]):
            line = _coerce_str(raw_line, limit=200)
            if line:
                lines.append(f"decision_reinforcement_{idx + 1}={line}")

    for key, limit in (
        ("setup_bias", 16),
        ("alignment_display", 80),
        ("execution_readiness_label", 48),
        ("execution_hint", 200),
        ("maturation_label", 80),
        ("conviction_tier", 24),
        ("conviction_label", 48),
        ("conviction_summary", 200),
    ):
        s = _coerce_str(ctx.get(key), limit=limit)
        if s:
            lines.append(f"{key}={s}")

    causal_summary = _coerce_str(ctx.get("causal_narrative_summary"), limit=400)
    if causal_summary:
        lines.append(f"causal_narrative_summary={causal_summary}")
    causal_chain = _coerce_str(ctx.get("causal_blocking_chain"), limit=120)
    if causal_chain:
        lines.append(f"causal_blocking_chain={causal_chain}")

    tf_label = _coerce_str(ctx.get("timeframe_alignment_label"), limit=200)
    if tf_label:
        lines.append(f"timeframe_alignment_label={tf_label}")

    numerics = {
        "trade_readiness": ctx.get("trade_readiness"),
        "risk_reward": ctx.get("risk_reward"),
        "layer_alignment_pct": ctx.get("layer_alignment_pct"),
    }
    for k, v in numerics.items():
        s = _coerce_num(v)
        if s:
            lines.append(f"{k}={s}")

    for k in ("trend_strength", "trend_direction", "market_regime", "environment_tier"):
        s = _coerce_str(ctx.get(k), limit=24)
        if s:
            lines.append(f"{k}={s}")

    env_headline = _coerce_str(ctx.get("environment_headline"), limit=280)
    if env_headline:
        lines.append(f"environment_headline={env_headline}")

    subscription_plan = _coerce_str(ctx.get("subscription_plan"), limit=24).lower()
    if subscription_plan in ("free", "swing_pro", "swing_day_pro"):
        lines.append(f"subscription_plan={subscription_plan}")

    for k in ("watchlist_max_symbols", "watchlist_symbol_count"):
        s = _coerce_num(ctx.get(k))
        if s:
            lines.append(f"{k}={s}")

    layer_status = ctx.get("layer_status")
    if isinstance(layer_status, dict):
        dissenting: list[str] = []
        for layer in ("technical", "news", "macro", "sector", "geopolitical", "internals"):
            status = _coerce_str(layer_status.get(layer), limit=24)
            if status:
                lines.append(f"layer_status_{layer}={status}")
                if status in ("Bearish", "Unavailable"):
                    dissenting.append(layer)
        if dissenting:
            lines.append(f"dissenting_layers={','.join(dissenting[:6])}")

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

    # Mode Separation B28 (Phase 1) — dual-desk dashboard posture. These two fields
    # feed the LLM's Priority 3 STRUCTURED DUAL ANSWER path: when both are present
    # in the page context, the dashboard is a dual-desk surface and an ambiguous
    # question must be answered with the two-paragraph template, not a single
    # "system overall" summary. The values mirror the visible posture pill state
    # on each desk so the LLM cannot describe a desk's state in terms that
    # disagree with the on-screen rendering.
    swing_desk_posture = _coerce_str(ctx.get("swing_desk_posture"), limit=32).lower()
    if swing_desk_posture in ("active", "monitor", "suppressed"):
        lines.append(f"swing_desk_posture={swing_desk_posture}")

    day_desk_posture = _coerce_str(ctx.get("day_desk_posture"), limit=48).lower()
    if day_desk_posture in (
        "active",
        "monitor",
        "suppressed_session_closed",
        "suppressed_no_confirmation",
        "suppressed_scanner_error",
    ):
        lines.append(f"day_desk_posture={day_desk_posture}")

    day_setups_count = _coerce_num(ctx.get("day_setups_count"))
    if day_setups_count:
        lines.append(f"day_setups_count={day_setups_count}")

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

    _append_gap_summary_lines(lines, ctx.get("top_gaps_with_catalyst"), "top_gap", 3)

    dc = ctx.get("dashboard_context")
    if isinstance(dc, dict):
        _serialize_dashboard_context_v1(lines, dc)

    gap_intel = ctx.get("gap_intel")
    if isinstance(gap_intel, dict):
        ph = gap_intel.get("phase") if isinstance(gap_intel.get("phase"), dict) else {}
        st = _coerce_str(ph.get("state"), limit=24).upper()
        if st in (
            "MARKET_CLOSED",
            "OFF_PRE",
            "PRE_MARKET",
            "SESSION_OPEN",
            "SESSION",
            "AFTER_HOURS",
            "OFF_POST",
        ):
            lines.append(f"gap_intel_phase_state={st}")
        lab = _coerce_str(ph.get("label"), limit=48)
        if lab:
            lines.append(f"gap_intel_phase_label={lab}")

        g = gap_intel.get("gap") if isinstance(gap_intel.get("gap"), dict) else {}
        d = _coerce_str(g.get("direction"), limit=12).upper()
        if d in ("UP", "DOWN", "NONE", "UNKNOWN"):
            lines.append(f"gap_intel_gap_direction={d}")
        gs = _coerce_str(g.get("status"), limit=24).upper()
        if gs:
            lines.append(f"gap_intel_gap_status={gs}")
        gr = _coerce_str(g.get("resolution_state"), limit=24).upper()
        if gr in ("PENDING", "CONFIRMED", "INVALIDATED", "RESOLVED"):
            lines.append(f"gap_intel_resolution_state={gr}")

        lv = gap_intel.get("levels") if isinstance(gap_intel.get("levels"), dict) else {}
        fl = lv.get("fill_level")
        if isinstance(fl, (int, float)) and fl == fl:  # not NaN
            lines.append(f"gap_intel_fill_level={_coerce_num(fl)}")
        fs = _coerce_str(lv.get("fill_source"), limit=32).upper()
        if fs in ("PRIOR_CLOSE", "PREVIOUS_SESSION_BAR", "NOT_DERIVABLE"):
            lines.append(f"gap_intel_fill_source={fs}")
        fr = _coerce_str(lv.get("fill_reliability"), limit=16).upper()
        if fr in ("HIGH", "EMERGING", "OFF", "PARTIAL"):
            lines.append(f"gap_intel_fill_reliability={fr}")

        lq = gap_intel.get("liquidity") if isinstance(gap_intel.get("liquidity"), dict) else {}
        if isinstance(lq.get("is_high_liquidity"), bool):
            lines.append(f"gap_intel_high_liquidity={'true' if lq['is_high_liquidity'] else 'false'}")

        sb = gap_intel.get("scenario_builder") if isinstance(gap_intel.get("scenario_builder"), dict) else {}
        sbs = _coerce_str(sb.get("state"), limit=16).upper()
        if sbs in ("DISABLED", "LIMITED", "ENABLED"):
            lines.append(f"gap_intel_scenario_builder_state={sbs}")
        rsns = sb.get("reasons")
        if isinstance(rsns, list):
            joined = ";".join(_coerce_str(x, limit=48) for x in rsns[:4] if x is not None)
            if joined:
                lines.append(f"gap_intel_scenario_builder_reasons={joined[:200]}")

        flg = gap_intel.get("flags") if isinstance(gap_intel.get("flags"), dict) else {}
        cs = _coerce_str(flg.get("calendar_state"), limit=20).upper()
        if cs in ("CONFIRMED", "UNCONFIRMED"):
            lines.append(f"gap_intel_calendar_state={cs}")
        if isinstance(flg.get("stale"), bool):
            lines.append(f"gap_intel_stale={'true' if flg['stale'] else 'false'}")

    structured = "\n".join(lines) + "\n"
    plain = serialize_page_context_plain_english(ctx)
    return structured + plain if plain else structured


PUBLIC_MARKETING_PAGE_PREFIX = "marketing/"


def sanitize_public_page_context(ctx: dict[str, Any] | None) -> dict[str, Any] | None:
    """Whitelist anonymous marketing context — never honor dashboard/symbol fields.

    Clients may only supply a ``marketing/*`` page id. All trading fields are dropped so a
    tampered request cannot impersonate an in-app Evidence card on the public route.
    """
    if not isinstance(ctx, dict):
        return None
    page = _coerce_str(ctx.get("page"), limit=64)
    if not page.startswith(PUBLIC_MARKETING_PAGE_PREFIX):
        return None
    return {"page": page, "session_mode": "public"}


def serialize_public_product_facts() -> str:
    """Authoritative product facts for LOGGED-OUT / marketing assistant turns."""
    lines = [
        "=== PRODUCT FACTS (PUBLIC) ===",
        "product=STOCVEST market analysis and decision-support (not investment advice)",
        "motto=Judgment. Restraint. Gating. Permission.",
        "value_prop=Explains when to trade and when to stay out; surfaces Actionable only when six layers align",
        "six_layers=Technical,News,Macro,Sector,Geopolitical,Market Internals",
        "decision_states=Actionable,Monitor only,Blocked",
        "modes=Swing (multi-day desk) and Day (intraday desk) — independent engines, never blended",
        "signup_url=/signup/agreements",
        "paid_plans=Swing Pro ($49/month) and Swing + Day Pro ($99/month) are the standard paid tiers",
        "swing_pro=$49/month — full swing signals, daily bar scanner, AI explanations, swing alerts, 50 watchlist symbols",
        "swing_day_pro=$99/month — everything in Swing Pro plus day signals, gap scanner, intraday signals, day alerts, priority support, 100 watchlist symbols",
        "watchlist_symbol_caps=Swing Pro: 50 symbols | Swing + Day Pro: 100 symbols | Beta full access: 100 symbols | Legacy free (being phased out): 5 symbols",
        "watchlist_limits=One default watchlist per account; symbol slots are plan-capped (not unlimited). Upgrade increases the cap.",
        "free_tier=Legacy $0 preview tier (limited; product direction is paid access with trial — do not promote as the long-term plan)",
        "homepage_search=Type a ticker for a sample system read; NFLX AAPL NVDA are full examples; other symbols show limited preview until signup",
        "assistant_public=Available on marketing pages for product education and finance terms (no per-stock verdicts)",
        "assistant_paid=Page-aware conversational explanations for Swing Pro and Swing+Day Pro subscribers",
        "first_minutes_after_signup=Add watchlist, see forming setups, open signals when alignment is strong, ask assistant, execute or skip with confidence",
    ]
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
