"""Rotating copy for empty / no-qualifying-news states (reduces repetitive phrasing across symbols)."""

from __future__ import annotations

import hashlib


def no_qualifying_news_reasoning(symbol: str) -> str:
    sym = symbol.strip().upper() or "TICKER"
    digest = hashlib.md5(sym.encode()).hexdigest()
    idx = int(digest[:8], 16) % 3
    if idx == 0:
        return (
            f"No qualifying news for {sym} in the lookback window. "
            "No active negative catalyst detected."
        )
    if idx == 1:
        return (
            f"No material news impacting {sym} in the lookback window. "
            "No company-specific catalysts detected."
        )
    return (
        "No company-specific catalysts detected in the filtered feed. "
        f"Nothing material on {sym} cleared quality filters in the window."
    )
