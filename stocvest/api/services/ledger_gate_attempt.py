"""Persist validation ledger rows (qualified or shadow gate attempts)."""

from __future__ import annotations

from stocvest.api.services.signal_backtest_capture import (
    enrich_record_for_backtest,
    mirror_platform_backtest_row,
)
from stocvest.api.services.signal_recorder import get_signal_recorder
from stocvest.data.models import SignalRecord
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

_SHADOW_PATTERN_SUFFIX = ":ledger_capture_shadow"


def persist_ledger_gate_attempt(
    record: SignalRecord,
    *,
    ledger_capture: bool,
    mode: str,
) -> None:
    """Write a qualified ledger row, or a shadow audit row when ``ledger_capture`` is set.

    Shadow rows keep ``ledger_qualified=False`` and ``ledger_position_open=False`` so they
    do not block dedupe or enter the open-position lifecycle. User history defaults to
    ``ledger_qualified_only=True`` and therefore hides shadow rows unless explicitly requested.
    """
    enriched = enrich_record_for_backtest(record, eligible=record.ledger_qualified)
    if enriched.ledger_qualified:
        get_signal_recorder().record_signal(enriched)
        mirror_platform_backtest_row(enriched)
        return
    if ledger_capture:
        shadow = enriched.model_copy(
            update={
                "ledger_qualified": False,
                "ledger_position_open": False,
                "ledger_entry_date_et": None,
                "pattern": _shadow_pattern(enriched.pattern),
                "capture_kind": "shadow",
            }
        )
        shadow = enrich_record_for_backtest(shadow, eligible=False)
        get_signal_recorder().record_signal(shadow)
        mirror_platform_backtest_row(shadow)
        _LOG.info(
            "ledger shadow row recorded mode=%s symbol=%s",
            mode,
            record.symbol,
        )
        return
    _LOG.info("%s ledger row skipped (gates) symbol=%s", mode, record.symbol)


def _shadow_pattern(pattern: str) -> str:
    base = (pattern or "composite").strip()
    if base.endswith(_SHADOW_PATTERN_SUFFIX):
        return base
    return f"{base}{_SHADOW_PATTERN_SUFFIX}"
