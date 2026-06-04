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
from datetime import datetime, timezone
from typing import Any, Literal

import httpx

import math

from stocvest.api.services.assistant_symbol_context import AssistantSymbolContext
from stocvest.data.models import UserProfile
from stocvest.signals.assistant_prompts import (
    ASSISTANT_SYSTEM_PROMPT,
    sanitize_assistant_user_reply,
    sanitize_messages,
    sanitize_public_page_context,
    serialize_page_context,
    serialize_public_product_facts,
)
from stocvest.signals.geopolitical_scanner import ANTHROPIC_API_URL, ANTHROPIC_VERSION
from stocvest.signals.historical_validation import HistoricalValidationSummary
from stocvest.signals.product_kpi import ProductKpiSummary
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
    navigate_to: str | None = None


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


HISTORICAL_VALIDATION_BLOCK_HEADER = "=== HISTORICAL VALIDATION ==="
SYMBOL_CONTEXT_BLOCK_HEADER = "=== LIVE SYMBOL CONTEXT"


def serialize_symbol_context(ctx: AssistantSymbolContext) -> str:
    """Render live market data for a ticker as a structured context block.

    The block is appended to the system message so Claude can synthesize a
    factual, data-grounded answer to questions like "why is MRVL up today?"
    without inventing information.

    Deliberately formats each sub-section for readability over compactness:
    field-name labels help Claude identify data points reliably even when
    some fields are absent.
    """
    if not ctx or not ctx.has_data:
        return ""

    lines: list[str] = [f"{SYMBOL_CONTEXT_BLOCK_HEADER}: {ctx.symbol} ==="]

    # ── STOCVEST's own read (lead with it) ───────────────────────────────────
    # When STOCVEST has a recent cached six-layer composite for this symbol, surface
    # it FIRST so the assistant can answer "what does STOCVEST think?" with the
    # system's own verdict before layering in external news. Absent ⇒ omitted (we
    # never invent a verdict).
    lines.extend(_stocvest_read_lines(getattr(ctx, "stocvest_read", None)))

    # ── Snapshot ────────────────────────────────────────────────────────────
    snap = ctx.snapshot
    if snap is not None:
        price = snap.last_trade_price
        chg_pct = snap.change_percent
        vol = snap.day_volume
        vwap = snap.day_vwap
        prev_vol = snap.prev_day_volume

        price_str = f"${price:.2f}" if price else "n/a"
        chg_str = (
            f"{chg_pct:+.2f}%" if chg_pct is not None else "n/a"
        )
        vol_str = _fmt_volume(vol)
        vwap_str = f"${vwap:.2f}" if vwap else "n/a"
        vol_ratio_str = ""
        if vol and prev_vol and prev_vol > 0:
            ratio = vol / prev_vol
            vol_ratio_str = f" ({ratio:.1f}x vs prior session)"

        lines.append("SNAPSHOT:")
        lines.append(f"  price={price_str}  change={chg_str}")
        lines.append(f"  volume={vol_str}{vol_ratio_str}")
        lines.append(f"  session_vwap={vwap_str}")

        if snap.pre_market_price and snap.pre_market_change_percent is not None:
            lines.append(
                f"  premarket_price=${snap.pre_market_price:.2f}"
                f"  premarket_change={snap.pre_market_change_percent:+.2f}%"
            )
        if snap.after_hours_price and snap.after_hours_change_percent is not None:
            lines.append(
                f"  afterhours_price=${snap.after_hours_price:.2f}"
                f"  afterhours_change={snap.after_hours_change_percent:+.2f}%"
            )
    elif ctx.bars_5m:
        # Snapshot unavailable, but intraday bars arrived — derive a minimal
        # price read so the answer is still grounded in real numbers instead of
        # falling back to "I don't have live data".
        try:
            first_close = float(ctx.bars_5m[0].close)
            last_close = float(ctx.bars_5m[-1].close)
            chg = ((last_close - first_close) / first_close * 100.0) if first_close else None
            lines.append("SNAPSHOT (derived from intraday bars):")
            lines.append(f"  price=${last_close:.2f}")
            if chg is not None:
                lines.append(f"  intraday_change={chg:+.2f}% (since first bar of the session window)")
        except (AttributeError, TypeError, ValueError, IndexError):
            pass

    # ── Why Is It Moving (Benzinga WIIM) ───────────────────────────────────
    if ctx.wim and ctx.wim.reason:
        lines.append("")
        lines.append("WHY IS IT MOVING (Benzinga analyst note):")
        lines.append(f"  direction={ctx.wim.direction}")
        lines.append(f"  reason={ctx.wim.reason}")

    # ── News articles ───────────────────────────────────────────────────────
    if ctx.news:
        lines.append("")
        lines.append(f"NEWS (last 24h, {len(ctx.news)} articles, newest first):")
        for i, article in enumerate(ctx.news[:8], 1):
            pub = article.published_at
            age = _age_label(pub)
            source = article.source or "unknown"
            title = article.title or ""
            desc = (article.description or "").strip()
            if desc and len(desc) > 300:
                desc = desc[:297] + "..."
            lines.append(f"  [{i}] {source} · {age}")
            lines.append(f"      headline: {title}")
            if desc:
                lines.append(f"      summary: {desc}")

    # ── Analyst consensus + ratings ──────────────────────────────────────────
    if ctx.analyst_ratings:
        last_price = None
        if snap is not None and snap.last_trade_price:
            last_price = float(snap.last_trade_price)
        elif snap is not None and snap.day_close:
            last_price = float(snap.day_close)
        lines.extend(_analyst_consensus_lines(ctx.analyst_ratings, last_price))
        lines.append("")
        lines.append(f"ANALYST RATINGS (last 30d, {len(ctx.analyst_ratings)} entries):")
        for r in ctx.analyst_ratings[:6]:
            pt_str = f"  pt=${r.price_target:.2f}" if r.price_target else ""
            date_str = r.published_at.strftime("%Y-%m-%d") if r.published_at else ""
            lines.append(
                f"  - {r.analyst_firm}: action={r.action}  rating={r.rating}{pt_str}  date={date_str}"
            )

    # ── Earnings results ────────────────────────────────────────────────────
    if ctx.earnings:
        lines.append("")
        lines.append("RECENT EARNINGS:")
        for e in ctx.earnings[:2]:
            beat_str = "beat" if e.beat is True else ("miss" if e.beat is False else "n/a")
            surprise_str = (
                f"  eps_surprise={e.eps_surprise_pct:+.1f}%"
                if e.eps_surprise_pct is not None
                else ""
            )
            eps_str = ""
            if e.eps_actual is not None and e.eps_estimate is not None:
                eps_str = f"  eps_actual=${e.eps_actual:.2f}  eps_estimate=${e.eps_estimate:.2f}{surprise_str}"
            elif e.eps_actual is not None:
                eps_str = f"  eps_actual=${e.eps_actual:.2f}"
            rev_str = ""
            if e.revenue_actual is not None:
                rev_str = f"  revenue_actual=${e.revenue_actual / 1e9:.2f}B" if e.revenue_actual > 1e8 else f"  revenue_actual=${e.revenue_actual / 1e6:.1f}M"
            lines.append(
                f"  period={e.period}  result={beat_str}{eps_str}{rev_str}"
            )

    # ── Corporate guidance ──────────────────────────────────────────────────
    if ctx.guidance:
        lines.append("")
        lines.append("CORPORATE GUIDANCE (recent):")
        for g in ctx.guidance[:3]:
            date_str = g.published_at.strftime("%Y-%m-%d") if g.published_at else ""
            lines.append(
                f"  - {g.guidance_type}  period={g.period}  date={date_str}  headline={g.headline[:120]}"
            )

    # ── Broader coverage (Benzinga newsfeed, channel-tagged) ─────────────────
    # Complements the structured catalyst sections above with general / M&A /
    # policy / sector headlines so the assistant has wider context. Deduped
    # against the Polygon NEWS section and the dedicated WIIM section.
    broader = _broader_coverage_lines(ctx)
    if broader:
        lines.append("")
        lines.append("BROADER COVERAGE (Benzinga newsfeed, last 48h, by channel):")
        lines.extend(broader)

    lines.append("")  # trailing newline
    return "\n".join(lines)


# Channel-keyword → short category label. First match wins; order matters.
_BENZINGA_CHANNEL_CATEGORIES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("analyst", ("analyst", "upgrade", "downgrade", "price target", "rating", "initiat")),
    ("m&a", ("m&a", "merger", "acquisition", "buyout", "takeover")),
    ("guidance/earnings", ("guidance", "earnings", "eps", "outlook")),
    ("policy/legal", ("government", "politic", "regulat", "legal", "lawsuit", "fda", "antitrust", "tariff")),
    ("capital", ("offering", "dividend", "buyback", "repurchase", "ipo", "insider", "split", "secondary")),
    ("markets/macro", ("macro", "econom", "fed", "inflation", "rates", "futures", "markets")),
    ("product/tech", ("product", "launch", "partnership", "contract", "tech")),
)


def _benzinga_channel_category(channels: list[str]) -> str:
    """Map a Benzinga article's channels to a short, human category label."""
    joined = " ".join(c.lower() for c in (channels or []))
    if not joined:
        return "general"
    for label, keywords in _BENZINGA_CHANNEL_CATEGORIES:
        if any(kw in joined for kw in keywords):
            return label
    return "general"


def _broader_coverage_lines(ctx: AssistantSymbolContext, *, limit: int = 6) -> list[str]:
    """Build deduped, channel-categorized headline lines from the Benzinga feed."""
    articles = getattr(ctx, "benzinga_news", None) or []
    if not articles:
        return []

    # Titles already shown in the Polygon NEWS section (avoid repeating).
    seen_titles = {((a.title or "").strip().lower()) for a in (ctx.news or [])}
    wim_reason = (ctx.wim.reason.strip().lower() if ctx.wim and ctx.wim.reason else "")

    out: list[str] = []
    for article in articles:
        title = (getattr(article, "title", "") or "").strip()
        if not title:
            continue
        key = title.lower()
        if key in seen_titles:
            continue
        # Skip pure WIIM items — already surfaced in the dedicated WIIM section.
        channels = getattr(article, "channels", []) or []
        if wim_reason and key == wim_reason:
            continue
        seen_titles.add(key)
        category = _benzinga_channel_category(channels)
        age = _age_label(getattr(article, "published_at", None))
        clipped = title if len(title) <= 140 else title[:137] + "..."
        out.append(f"  - [{category}] {clipped}  ({age})")
        if len(out) >= limit:
            break
    return out


def _stocvest_read_lines(read: dict | None) -> list[str]:
    """Render STOCVEST's cached composite read as a leading context section.

    Returns an empty list when no read is present so the block is simply omitted
    (the prompt's STOCVEST READ rule then stays silent rather than inventing one).
    """
    if not isinstance(read, dict):
        return []
    verdict = str(read.get("verdict") or "").strip().lower()
    if verdict not in ("bullish", "bearish", "neutral"):
        return []

    mode = str(read.get("mode") or "swing").strip().lower()
    out: list[str] = ["", f"STOCVEST'S CURRENT READ (six-layer composite, {mode} desk):"]
    out.append(f"  verdict={verdict}")

    leans = read.get("leans") if isinstance(read.get("leans"), dict) else {}
    if leans:
        b = int(leans.get("bullish", 0) or 0)
        be = int(leans.get("bearish", 0) or 0)
        n = int(leans.get("neutral", 0) or 0)
        avail = int(leans.get("available", 0) or 0)
        out.append(
            f"  layer_leans={b} bullish / {be} bearish / {n} neutral"
            f" (of {avail} contributing layers)"
        )

    align = str(read.get("alignment_label") or "").strip()
    ratio = read.get("alignment_ratio")
    if align and ratio is not None:
        out.append(f"  alignment={align} (ratio={ratio})")
    elif align:
        out.append(f"  alignment={align}")
    elif ratio is not None:
        out.append(f"  alignment_ratio={ratio}")

    regime = str(read.get("regime") or "").strip()
    if regime:
        out.append(f"  market_regime={regime}")

    reasoning = str(read.get("reasoning") or "").strip()
    if reasoning:
        out.append(f"  reasoning={reasoning}")

    if read.get("stale"):
        out.append("  freshness=last cached evaluation (may be from a prior session)")

    out.append("")  # separate from the snapshot section that follows
    return out


# Rating-string buckets for a coarse buy/hold/sell consensus lean. Lowercased
# substring match; first matching bucket wins. Order matters (check bearish/
# bullish modifiers before the generic words).
_RATING_BULLISH = ("strong buy", "buy", "outperform", "overweight", "accumulate", "positive", "add")
_RATING_BEARISH = ("strong sell", "sell", "underperform", "underweight", "reduce", "negative")
_RATING_NEUTRAL = ("hold", "neutral", "market perform", "sector perform", "equal", "in-line", "in line", "peer perform")


def _classify_rating(rating: str) -> str:
    """Bucket an analyst rating string into bullish / neutral / bearish / unknown."""
    r = str(rating or "").strip().lower()
    if not r:
        return "unknown"
    for kw in _RATING_NEUTRAL:
        if kw in r:
            return "neutral"
    for kw in _RATING_BEARISH:
        if kw in r:
            return "bearish"
    for kw in _RATING_BULLISH:
        if kw in r:
            return "bullish"
    return "unknown"


def _analyst_consensus_lines(ratings: list, last_price: float | None) -> list[str]:
    """Aggregate raw analyst ratings into a clean consensus summary for narration.

    Pre-computing the average/high/low target, the implied move versus the current
    price, the buy/hold/sell mix, and the most-recent action gives Claude clean
    facts to turn into a plain-English forecast narrative — instead of forcing it
    to do arithmetic over a list of rows (which it does inconsistently).
    """
    rows = [r for r in (ratings or []) if r is not None]
    if not rows:
        return []

    targets = []
    for r in rows:
        pt = getattr(r, "price_target", None)
        try:
            if pt is not None and float(pt) > 0:
                targets.append(float(pt))
        except (TypeError, ValueError):
            continue

    bull = sum(1 for r in rows if _classify_rating(getattr(r, "rating", "")) == "bullish")
    hold = sum(1 for r in rows if _classify_rating(getattr(r, "rating", "")) == "neutral")
    bear = sum(1 for r in rows if _classify_rating(getattr(r, "rating", "")) == "bearish")

    out: list[str] = ["", "ANALYST CONSENSUS (synthesize this into a plain-English forecast):"]

    if targets:
        avg = sum(targets) / len(targets)
        lo, hi = min(targets), max(targets)
        line = f"  price_target_avg=${avg:.2f}  range=${lo:.2f}-${hi:.2f}  (n_targets={len(targets)})"
        out.append(line)
        if last_price and last_price > 0:
            implied = (avg - last_price) / last_price * 100.0
            out.append(
                f"  implied_vs_current={implied:+.1f}% (current ${last_price:.2f} -> avg target ${avg:.2f})"
            )
    else:
        out.append("  price_target_avg=n/a (no targets in the recent ratings)")

    mix_parts = []
    if bull:
        mix_parts.append(f"{bull} buy/outperform")
    if hold:
        mix_parts.append(f"{hold} hold/neutral")
    if bear:
        mix_parts.append(f"{bear} sell/underperform")
    if mix_parts:
        out.append(f"  rating_mix={' / '.join(mix_parts)} (of {len(rows)} ratings)")

    # Most-recent action — rows arrive newest-first from Benzinga; fall back to
    # an explicit max-by-date if ordering is ever not guaranteed.
    try:
        latest = max(rows, key=lambda r: getattr(r, "published_at", None) or datetime.min.replace(tzinfo=timezone.utc))
    except (TypeError, ValueError):
        latest = rows[0]
    firm = str(getattr(latest, "analyst_firm", "") or "an analyst").strip()
    action = str(getattr(latest, "action", "") or "").strip()
    rating = str(getattr(latest, "rating", "") or "").strip()
    lpt = getattr(latest, "price_target", None)
    ldate = getattr(latest, "published_at", None)
    pt_txt = f" with a ${float(lpt):.2f} target" if lpt else ""
    date_txt = f" on {ldate.strftime('%Y-%m-%d')}" if ldate else ""
    out.append(f"  most_recent={firm} {action} ({rating}){pt_txt}{date_txt}")

    return out


def _fmt_volume(vol: float | int | None) -> str:
    if vol is None:
        return "n/a"
    if vol >= 1_000_000:
        return f"{vol / 1_000_000:.1f}M"
    if vol >= 1_000:
        return f"{vol / 1_000:.0f}K"
    return str(int(vol))


def _age_label(dt: "datetime | None") -> str:  # noqa: F821
    if dt is None:
        return "unknown time"
    now = __import__("datetime").datetime.now(__import__("datetime").timezone.utc)
    try:
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=__import__("datetime").timezone.utc)
        diff = int((now - dt).total_seconds())
    except Exception:
        return "unknown time"
    if diff < 3600:
        return f"{diff // 60}m ago"
    if diff < 86400:
        return f"{diff // 3600}h ago"
    return dt.strftime("%Y-%m-%d")


def _fmt_accuracy_percent(value: float) -> str:
    """Format an accuracy fraction (NaN / 0..1) for the assistant context block.

    NaN (no resolved-non-neutral trades) renders as the em-dash — never as ``"0.0%"``
    or the literal string ``"NaN"``. Matches the wire contract that the
    `/historical-validation/summary` endpoint and the dashboard panel both honor, so
    the same calm "no data yet" framing reaches the LLM that reaches the screen.
    """

    if value is None or not isinstance(value, (int, float)) or math.isnan(value):
        return "—"
    return f"{value * 100:.1f}%"


def serialize_historical_validation_summary(
    summary: HistoricalValidationSummary | None,
    *,
    window_days: int,
    product_kpi: ProductKpiSummary | None = None,
) -> str:
    """Render the user's HistoricalValidationSummary as a compact tail block.

    The block is appended to the system message of the **authenticated** chat path so
    the LLM can answer "how has my track record been doing?" with real per-user numbers.
    Returns an **empty string** when:

    - ``summary`` is ``None`` (handler skipped or failed the fetch).
    - ``summary.rows_examined == 0`` (the user has no signals in the window).

    In both cases the chat service does not append anything and the prompt's
    HISTORICAL VALIDATION CONTEXT section's "if the field is absent, do not comment"
    rule activates.

    Deliberately trimmed projection — same projection the public mirror serves on
    ``/performance``: ``overall`` accuracy + ``by_mode`` (swing/day) + ``rows_examined``
    only. The per-decision / per-regime / per-pattern / per-readiness / per-direction
    stratifications are NOT shipped to the LLM, even though we have them, because:

    - They would tempt per-symbol or per-pattern follow-ups that the prompt rules forbid.
    - They are tightly tied to engine internals; surfacing them via natural-language
      paraphrase would risk the LLM inventing detail (e.g. "your VWAP setups have been
      working better than your gap setups, focus there") that crosses the advice line.
    - The dashboard panel already renders the full breakdown for the user; the
      assistant's job is the framework-level summary, not the stratified detail view.
    """

    if summary is None:
        return ""
    if summary.rows_examined <= 0:
        return ""

    lines: list[str] = [
        HISTORICAL_VALIDATION_BLOCK_HEADER,
        "cohort=qualified_actionable_ledger_approved_only",
        f"window_days={int(window_days)}",
        f"horizon={summary.horizon}",
    ]
    if product_kpi is not None:
        lines.append(f"meets_minimum_sample={product_kpi.meets_minimum_sample}")
        lines.append(f"resolved_non_neutral={product_kpi.coverage.resolved_non_neutral}")
        lines.append(f"cohort_rows={product_kpi.coverage.cohort_rows}")

    overall = summary.overall
    resolved = overall.correct + overall.incorrect
    lines.append(
        "overall="
        f"{_fmt_accuracy_percent(overall.accuracy)} "
        f"({overall.correct} correct of {resolved} resolved; "
        f"{overall.neutral} neutral; {overall.total_signals} total)"
    )

    # Only emit a per-mode line when the bucket actually has rows. An empty bucket
    # (Phase 1 pre-seeds the vocabulary so swing/day always appear as keys) would
    # otherwise produce a calm-but-misleading "swing=— (0 correct of 0 resolved)" line
    # that the LLM might paraphrase as "your swing track has no data" instead of just
    # not mentioning it.
    for key in ("swing", "day"):
        bucket = summary.by_mode.get(key)
        if bucket is None or bucket.total_signals <= 0:
            continue
        bucket_resolved = bucket.correct + bucket.incorrect
        lines.append(
            f"{key}="
            f"{_fmt_accuracy_percent(bucket.accuracy)} "
            f"({bucket.correct} correct of {bucket_resolved} resolved; "
            f"{bucket.total_signals} total)"
        )

    lines.append(f"rows_examined={summary.rows_examined}")
    lines.append("")  # trailing newline so the block sits cleanly above any next block
    return "\n".join(lines)


class AssistantChatService:
    """Paid-only conversational explanations with a calm deterministic fallback for free users."""

    async def reply(
        self,
        *,
        messages: list[dict[str, str]],
        page_context: dict[str, Any] | None,
        user_profile: UserProfile,
        historical_validation_summary: HistoricalValidationSummary | None = None,
        historical_validation_window_days: int = 90,
        product_kpi_summary: ProductKpiSummary | None = None,
        symbol_context: AssistantSymbolContext | None = None,
        attached_image: dict[str, str] | None = None,
        discovery_context: str = "",
        market_context: str = "",
        watchlist_context: str = "",
        preference_context: str = "",
    ) -> AssistantChatResult:
        """Authenticated chat turn.

        ``historical_validation_summary`` is an optional server-fetched per-user
        Phase 2 summary. When non-None and non-empty (rows_examined > 0), it is
        serialized into a calm tail block appended to the system message so the LLM
        can ground "how has my track record been doing?"-style questions in real
        numbers without ever crossing into per-symbol territory. The fetch is the
        handler's responsibility (it owns I/O); this service stays a pure prompt /
        Claude composition layer.
        """

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
        validation_block = serialize_historical_validation_summary(
            historical_validation_summary,
            window_days=historical_validation_window_days,
            product_kpi=product_kpi_summary,
        )
        if validation_block:
            system_text += "\n" + validation_block
        symbol_block = serialize_symbol_context(symbol_context) if symbol_context else ""
        if symbol_block:
            system_text += "\n" + symbol_block
        if market_context:
            system_text += "\n" + market_context
        if discovery_context:
            system_text += "\n" + discovery_context
        if watchlist_context:
            system_text += "\n" + watchlist_context
        if preference_context:
            system_text += "\n" + preference_context
        # Increase token budget when live symbol or discovery data is present.
        max_tokens = (
            900
            if (symbol_block or discovery_context or market_context or watchlist_context)
            else 380
        )
        ai_text = await self._claude_chat_or_none(
            system=system_text,
            messages=clean,
            max_tokens=max_tokens,
            attached_image=attached_image,
        )
        if ai_text:
            return AssistantChatResult(
                text=sanitize_assistant_user_reply(ai_text.strip()),
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
        page_context: dict[str, Any] | None = None,
    ) -> AssistantChatResult:
        """Anonymous (unauthenticated) chat for the marketing surface.

        Only whitelisted ``marketing/*`` page ids are honored; symbol/decision fields from
        the client are stripped. Product facts are always appended so pricing and feature
        questions stay accurate. The locked PUBLIC MODE section still refuses per-stock
        verdicts, trade calls, and invented accuracy claims.

        Claude is called directly (no paid-feature gate). If Claude is unreachable the
        visitor still gets a calm deterministic introduction.
        """
        clean = sanitize_messages(messages)
        if not clean or clean[-1].get("role") != "user":
            return AssistantChatResult(
                text=(
                    "I'm the STOCVEST Assistant. Ask me what STOCVEST is, how pricing works, "
                    "how it differs from signal-alert services, or for an explanation of a "
                    "finance term like R/R, EMA, VWAP, or ORB."
                ),
                source="deterministic",
                mode="general",
                upgrade_available=True,
            )

        marketing_ctx = sanitize_public_page_context(page_context)
        system_text = ASSISTANT_SYSTEM_PROMPT + "\n" + serialize_public_product_facts()
        if marketing_ctx:
            system_text += "\n" + serialize_page_context(marketing_ctx)
        else:
            system_text += "\n=== PAGE CONTEXT ===\nmode=general\nsession_mode=public\n"
        ai_text = await self._claude_chat_or_none(
            system=system_text,
            messages=clean,
            max_tokens=400,
        )
        if ai_text:
            return AssistantChatResult(
                text=sanitize_assistant_user_reply(ai_text.strip()),
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
        attached_image: dict[str, str] | None = None,
    ) -> str | None:
        settings = get_settings()
        api_key = (settings.anthropic_api_key or os.environ.get("ANTHROPIC_API_KEY") or "").strip()
        if not api_key:
            return None

        # When an image is attached, upgrade the last user message to a
        # multi-part content block so Claude vision can inspect it.
        wire_messages: list[dict] = list(messages)
        if (
            attached_image
            and isinstance(attached_image.get("data"), str)
            and isinstance(attached_image.get("media_type"), str)
            and wire_messages
            and wire_messages[-1].get("role") == "user"
        ):
            last = wire_messages[-1]
            wire_messages = wire_messages[:-1] + [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": attached_image["media_type"],
                                "data": attached_image["data"],
                            },
                        },
                        {"type": "text", "text": last.get("content", "")},
                    ],
                }
            ]

        payload = {
            "model": AI_MODEL_FAST,
            "max_tokens": max_tokens,
            "temperature": 0,
            "system": system,
            "messages": wire_messages,
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
