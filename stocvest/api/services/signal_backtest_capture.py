"""Platform backtest capture — PUBLIC mirror rows and audit metadata for D2 replay.

Every ledger write (qualified or shadow) is enriched with ``decision_state_entry``,
``capture_kind``, and a de-identified ``PUBLIC`` copy so admin desk backtesting can
query one scope instead of scanning all user partitions.
"""

from __future__ import annotations

from typing import Any, Literal

from stocvest.data.models import SignalRecord
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

CaptureKind = Literal["qualified", "shadow", "live"]
DecisionState = Literal["actionable", "monitor", "blocked"]

_SHADOW_SUFFIX = ":ledger_capture_shadow"
_PLATFORM_MIRROR_PREFIX = "pub-"


def platform_mirror_signal_id(source_signal_id: str) -> str:
    """Deterministic PUBLIC row id for a user-scoped capture (Dynamo hash key)."""
    sid = (source_signal_id or "").strip()
    if not sid:
        raise ValueError("source_signal_id required for platform mirror")
    if sid.startswith(_PLATFORM_MIRROR_PREFIX):
        return sid
    return f"{_PLATFORM_MIRROR_PREFIX}{sid}"


def is_platform_mirror_row(record: SignalRecord) -> bool:
    return (record.user_id is None) and str(record.signal_id or "").startswith(
        _PLATFORM_MIRROR_PREFIX
    )


def infer_capture_kind(record: SignalRecord) -> CaptureKind:
    raw = (record.capture_kind or "").strip().lower()
    if raw in ("qualified", "shadow", "live"):
        return raw  # type: ignore[return-value]
    if record.ledger_qualified:
        return "qualified"
    if _SHADOW_SUFFIX in (record.pattern or ""):
        return "shadow"
    return "live"


def decision_state_from_gate_blob(gate_status_json: str | None) -> DecisionState | None:
    """Read composite ``decision_state`` gate value when present (audit / shadow rows)."""
    if not gate_status_json or not str(gate_status_json).strip():
        return None
    try:
        import json

        blob = json.loads(gate_status_json)
    except (json.JSONDecodeError, TypeError):
        return None
    if not isinstance(blob, dict):
        return None
    gates = blob.get("gates")
    if not isinstance(gates, dict):
        return None
    ds = gates.get("decision_state")
    if not isinstance(ds, dict):
        return None
    val = str(ds.get("value") or "").strip().lower()
    if val in ("actionable", "monitor", "blocked"):
        return val  # type: ignore[return-value]
    return None


def infer_decision_state_entry(
    record: SignalRecord,
    *,
    eligible: bool | None = None,
) -> DecisionState:
    raw = (record.decision_state_entry or "").strip().lower()
    if raw in ("actionable", "monitor", "blocked"):
        return raw  # type: ignore[return-value]
    is_eligible = record.ledger_qualified if eligible is None else bool(eligible)
    if is_eligible:
        return "actionable"
    from_gates = decision_state_from_gate_blob(record.gate_status_json)
    if from_gates is not None:
        return from_gates
    if str(record.direction or "").strip().lower() == "neutral":
        return "monitor"
    return "blocked"


def enrich_record_for_backtest(
    record: SignalRecord,
    *,
    eligible: bool | None = None,
) -> SignalRecord:
    """Ensure stratification columns are populated before persistence."""
    kind = infer_capture_kind(record)
    decision = infer_decision_state_entry(record, eligible=eligible)
    updates: dict[str, Any] = {
        "capture_kind": kind,
        "decision_state_entry": decision,
    }
    if not record.regime_label_at_entry:
        regime = _regime_from_gate_blob(record.gate_status_json)
        if regime:
            updates["regime_label_at_entry"] = regime
    return record.model_copy(update=updates)


def build_platform_mirror(record: SignalRecord) -> SignalRecord:
    """De-identified copy for PUBLIC-scope backtesting (no ``user_id``)."""
    source_id = record.signal_id.strip()
    return record.model_copy(
        update={
            "signal_id": platform_mirror_signal_id(source_id),
            "user_id": None,
            "source_signal_id": source_id,
            "ai_summary": None,
        }
    )


def mirror_platform_backtest_row(record: SignalRecord) -> None:
    """Write or refresh the PUBLIC mirror for a user-scoped capture."""
    if not record.user_id:
        return
    from stocvest.api.services.signal_recorder import get_signal_recorder

    mirror = build_platform_mirror(record)
    try:
        get_signal_recorder().record_signal(mirror)
    except Exception as exc:  # pragma: no cover — defensive
        _LOG.warning(
            "platform backtest mirror failed source=%s: %s",
            record.signal_id,
            exc,
        )


def _regime_from_gate_blob(gate_status_json: str | None) -> str | None:
    if not gate_status_json or not str(gate_status_json).strip():
        return None
    try:
        import json

        blob = json.loads(gate_status_json)
    except (json.JSONDecodeError, TypeError):
        return None
    if not isinstance(blob, dict):
        return None
    gates = blob.get("gates")
    if isinstance(gates, dict):
        macro = gates.get("macro_regime") or gates.get("macro")
        if isinstance(macro, dict):
            r = str(macro.get("regime") or macro.get("value") or "").strip().lower()
            if r in ("risk_on", "neutral", "risk_off", "avoid"):
                return r
    return None
