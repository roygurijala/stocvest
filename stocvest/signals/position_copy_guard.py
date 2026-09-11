"""Position-desk copy compliance guard — ADR-004 POS-D12 (enforcement half).

Deterministic, network-free checker that flags **advice / recommendation / valuation-
conclusion** language in any user-facing Position-desk copy (glass-box thesis bullets,
gem "why" strings, deterministic reads, and — critically — the AI Investment Read).

The Position desk is informational screening only: it presents pillars and lets the user
decide. So the copy must never tell the user to act (buy/sell/own/allocate), assert a
valuation *conclusion* ("undervalued"), use analyst-rating language ("strong buy"), or
hype ("back up the truck"). This module is the runtime + test-time backstop for that rule.

It is intentionally conservative to avoid false positives on legitimate fundamental
terminology — e.g. it does NOT flag the noun "capital allocation" or 3rd-person
"management allocates capital well" (describing the company), only advice framing
("allocate to this name", "you should allocate"). See the tests for the precise contract.

Counsel sign-off on the "gem" marketing copy (POS-D12) is tracked separately in BACKLOG;
this guard enforces the mechanical banned-phrase rules regardless.

PERSONAL-MODE (``stocvest_personal_advice_mode_enabled``): the banned phrases are split
into two families — ADVICE (buy/sell/own, valuation conclusions, recommendations) and
HYPE (return guarantees, "back up the truck", "screaming buy", …). When personal mode is
ON, only the HYPE family is enforced, so the operator's private tool may state a plain
buy/watch/avoid stance while the AI still can never hype or guarantee. In product mode
(flag OFF) BOTH families are enforced — the original, stricter POS-D12 contract.
"""

from __future__ import annotations

import re

from stocvest.utils.config import get_settings

# ADVICE family — relaxed in personal mode (allowed when the operator opts in).
# (human label, compiled pattern). Labels are stable — tests + logs key off them.
_ADVICE_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    # Analyst-rating language.
    ("strong buy/sell", re.compile(r"\bstrong\s+(?:buy|sell)\b", re.IGNORECASE)),
    ("buy/sell rating", re.compile(r"\b(?:buy|sell)\s+rating\b", re.IGNORECASE)),
    # Direct action advice ("should own", "must buy", "need to accumulate", …).
    (
        "action advice",
        re.compile(
            r"\b(?:should|must|ought\s+to|need\s+to|have\s+to)\s+"
            r"(?:buy|sell|own|hold|accumulate|avoid|add|trim|dump|short)\b",
            re.IGNORECASE,
        ),
    ),
    # Second-person / imperative buy-sell framing.
    ("imperative buy/sell", re.compile(r"\b(?:buy|sell)\s+now\b", re.IGNORECASE)),
    ("buy the dip", re.compile(r"\bbuy\s+the\s+dip\b", re.IGNORECASE)),
    ("time to buy/sell", re.compile(r"\btime\s+to\s+(?:buy|sell)\b", re.IGNORECASE)),
    # Advice-framed allocation (NOT the noun "capital allocation" / "management allocates").
    (
        "allocation advice",
        re.compile(
            r"\b(?:should\s+allocate|allocate\s+(?:your|to|into|toward|a\s+position))\b",
            re.IGNORECASE,
        ),
    ),
    # Valuation *conclusions* we never assert (glass-box states facts, not verdicts).
    ("valuation conclusion", re.compile(r"\b(?:under|over)valued\b", re.IGNORECASE)),
    # Recommendation language.
    ("recommendation", re.compile(r"\brecommend(?:s|ed|ing|ation)?\b", re.IGNORECASE)),
    # Prescriptive ownership.
    ("prescriptive ownership", re.compile(r"\bmust[-\s]?(?:own|buy|have)\b", re.IGNORECASE)),
)

# HYPE / guarantee family — ALWAYS enforced, in every mode.
_HYPE_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("hype: back up the truck", re.compile(r"\bback\s+up\s+the\s+truck\b", re.IGNORECASE)),
    ("hype: load up", re.compile(r"\bload\s+(?:up|the\s+boat)\b", re.IGNORECASE)),
    ("hype: table-pounding", re.compile(r"\btable[-\s]?pounding\b", re.IGNORECASE)),
    ("hype: screaming buy", re.compile(r"\bscreaming\s+buy\b", re.IGNORECASE)),
    ("hype: no-brainer", re.compile(r"\bno[-\s]?brainer\b", re.IGNORECASE)),
    ("hype: slam dunk", re.compile(r"\bslam\s+dunk\b", re.IGNORECASE)),
    ("hype: can't miss", re.compile(r"\bcan'?t\s+miss\b", re.IGNORECASE)),
    ("hype: sure thing", re.compile(r"\bsure\s+thing\b", re.IGNORECASE)),
    ("hype: get rich", re.compile(r"\bget\s+rich\b", re.IGNORECASE)),
    # Return guarantees ("guaranteed gains") — NOT the standing "does not guarantee" disclaimer.
    (
        "guaranteed return",
        re.compile(
            r"\bguarantee(?:d|s)?\s+(?:\w+\s+){0,2}?(?:returns?|profits?|gains?|money)\b",
            re.IGNORECASE,
        ),
    ),
)

# Full contract (product mode): advice + hype.
_BANNED_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = _ADVICE_PATTERNS + _HYPE_PATTERNS


def _advice_allowed() -> bool:
    """True when personal mode relaxes the ADVICE family (HYPE stays enforced)."""
    return bool(get_settings().stocvest_personal_advice_mode_enabled)


def find_position_copy_violations(
    text: str | None, *, allow_advice: bool | None = None
) -> list[str]:
    """Return the (unique, order-preserved) labels of banned phrases present in ``text``.

    Empty list == clean. Purely lexical; safe to run on any string (thesis bullets, gem
    ``why`` copy, deterministic reads, or a Claude Investment Read before it is cached).

    ``allow_advice`` overrides the mode: ``True`` enforces only the HYPE family (personal
    mode), ``False`` enforces the full advice+hype contract (product mode). When ``None``
    (default) it reads ``stocvest_personal_advice_mode_enabled`` from settings.
    """
    if not text or not text.strip():
        return []
    if allow_advice is None:
        allow_advice = _advice_allowed()
    patterns = _HYPE_PATTERNS if allow_advice else _BANNED_PATTERNS
    hits: list[str] = []
    seen: set[str] = set()
    for label, pattern in patterns:
        if label in seen:
            continue
        if pattern.search(text):
            hits.append(label)
            seen.add(label)
    return hits


def position_copy_is_clean(text: str | None, *, allow_advice: bool | None = None) -> bool:
    """True when ``text`` contains no banned language (mode-aware; see the finder)."""
    return not find_position_copy_violations(text, allow_advice=allow_advice)


def enforce_position_read(
    ai_text: str | None, fallback_text: str, *, allow_advice: bool | None = None
) -> tuple[str, bool]:
    """Gate an AI Investment Read: keep it only if compliant, else use the deterministic read.

    Returns ``(text, used_fallback)``. ``used_fallback`` is True when the AI text was empty
    or tripped the guard, so callers can downgrade ``source`` to ``deterministic`` and log.
    The deterministic read is built from the packet's own (already-compliant) literals, so
    it is a safe, non-advisory fallback. ``allow_advice`` follows the finder's semantics.
    """
    candidate = (ai_text or "").strip()
    if not candidate:
        return fallback_text, True
    if find_position_copy_violations(candidate, allow_advice=allow_advice):
        return fallback_text, True
    return candidate, False
