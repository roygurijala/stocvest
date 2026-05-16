"""Persist evaluation traces from setups handlers (B33 phase 2)."""

from __future__ import annotations

from typing import Any

from stocvest.data.scanner_evaluation_trace_store import put_scanner_evaluation_trace


def persist_evaluation_trace_rows(
    user_id: str | None,
    desk: str,
    rows: list[dict[str, Any]],
) -> None:
    if not user_id or not rows:
        return
    put_scanner_evaluation_trace(user_id, desk, rows)
