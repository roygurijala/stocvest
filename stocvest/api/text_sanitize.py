"""Sanitize user-controlled strings before persistence or logging."""

from __future__ import annotations

import re
from typing import Any

# Strip C0 controls except tab/newline/carriage return (avoid log injection / NUL bytes in stores).
_CONTROL_EXCEPT_WS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")

DEFAULT_FREE_TEXT_MAX = 8000
WATCHLIST_NAME_MAX = 100
SETUP_TYPE_MAX = 128
STRATEGY_TAG_MAX = 64
SIGNAL_META_MAX = 256


def _strip_controls(s: str) -> str:
    return _CONTROL_EXCEPT_WS.sub("", s)


def sanitize_free_text(value: Any, *, max_len: int) -> str:
    """Normalize free text: strip controls (except common whitespace), trim ends, enforce max length."""
    s = _strip_controls(str(value))
    s = s.strip()
    if len(s) > max_len:
        s = s[:max_len]
    return s


def sanitize_optional_free_text(value: Any, *, max_len: int) -> str | None:
    """Like sanitize_free_text but returns None for None input or all-whitespace after cleaning."""
    if value is None:
        return None
    s = sanitize_free_text(value, max_len=max_len)
    return s if s else None


def sanitize_strategy_tags(raw: Any, *, per_tag_max: int = STRATEGY_TAG_MAX, max_tags: int = 32) -> tuple[str, ...]:
    if not isinstance(raw, list):
        return ()
    out: list[str] = []
    for x in raw[:max_tags]:
        t = sanitize_free_text(x, max_len=per_tag_max)
        if t:
            out.append(t)
    return tuple(out)
