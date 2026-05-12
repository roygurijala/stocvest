"""DynamoDB rows for candidate SignalParameters rotations awaiting admin review.

D10 Phase 1 — foundation for the proposal-only weight-tuning pipeline. This
module is the **data layer only**. It does not produce proposals (Phase 2),
does not surface them to admins (Phase 3), and does not roll back live
parameters on degradation (Phase 4). It ships dark on purpose — no production
behavior change today.

Why this lives next to `parameter_history_store.py` but in a separate table:

  * `ParameterHistory` is the audit log of weights that actually went live.
    Every row reflects a real production-state transition; consumers
    (`docs/TUNING_PLAYBOOK.md`, the D2 cross-version diff view) treat it as
    a clean linear timeline.
  * `ParameterProposal` (this module) is the candidate pipeline. Most rows
    here will be rejected or superseded; mixing them into `ParameterHistory`
    would pollute the live-rotation timeline.

Security model (foreshadowing Phase 2 + Phase 3):

  * The Phase-2 optimizer Lambda role will have IAM
    `dynamodb:PutItem` on this table but **not** `secretsmanager:UpdateSecret`.
    It can write proposals but cannot promote them — the human-in-the-loop
    gate is enforced at the IAM boundary, not the application layer.
  * The Phase-3 admin endpoint role will have IAM
    `dynamodb:UpdateItem` on this table (to mark proposals promoted/rejected)
    AND `secretsmanager:UpdateSecret` on `stocvest/signal-parameters`. It is
    the only path that writes live weights.

Lifecycle states (closed-set, validated at the application layer):

  pending      → fresh proposal awaiting admin review
  promoted     → admin clicked "Approve"; ParameterStore.save_parameters_sync
                 was called; `promoted_to_version` records the resulting
                 `SignalParameters.version`
  rejected     → admin clicked "Reject with note"; row TTLs out after 90 days
  superseded   → a newer pending proposal was promoted before this one was
                 reviewed; row TTLs out after 90 days

Transitions are atomic via DDB ConditionalCheckExpression — a rejected
proposal cannot be re-promoted, a promoted proposal cannot be re-rejected,
etc. This is enforced inside `mark_promoted` / `mark_rejected` /
`mark_superseded`.
"""

from __future__ import annotations

import json
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

from stocvest.utils.config import get_settings
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

# ── Lifecycle states (closed-set) ─────────────────────────────────────────
PROPOSAL_STATUS_PENDING = "pending"
PROPOSAL_STATUS_PROMOTED = "promoted"
PROPOSAL_STATUS_REJECTED = "rejected"
PROPOSAL_STATUS_SUPERSEDED = "superseded"

PROPOSAL_STATUS_VALUES: tuple[str, ...] = (
    PROPOSAL_STATUS_PENDING,
    PROPOSAL_STATUS_PROMOTED,
    PROPOSAL_STATUS_REJECTED,
    PROPOSAL_STATUS_SUPERSEDED,
)

# GSI name (mirrors `infra/dynamodb.tf`).
GSI_STATUS_INDEX = "status_index"

# Default TTL window for rejected / superseded proposals (90 days). Promoted
# proposals deliberately have no TTL — they're the audit trail of approvals
# and must persist alongside `ParameterHistory`.
PROPOSAL_TTL_DAYS = 90


@dataclass
class ParameterProposal:
    """A proposed weight rotation awaiting admin review.

    The two ``proposed_*_composite`` fields carry the per-mode override blocks
    in the same shape as `stocvest.config.signal_parameters.CompositeParameters`
    (dict-encoded). Either may be ``None`` if the optimizer proposes a change
    to only one mode — but at least one must be non-``None`` (enforced in
    :meth:`new_pending`), since a proposal with neither side filled in carries
    no information.

    The ``evidence`` dict is the load-bearing transparency layer: it captures
    the metrics that justify the proposal so a human reviewer can audit the
    decision before promotion. By convention (Phase 2 will lock this contract
    with tests) it has this shape::

        {
          "swing": {
            "train_accuracy": 0.62,
            "val_accuracy": 0.64,
            "train_accuracy_baseline": 0.59,
            "val_accuracy_baseline": 0.60,
            "val_signal_count": 87,
            "regime_distribution": {"risk_on": 50, "neutral": 30, "risk_off": 7}
          },
          "day": {...same shape...}
        }

    Phase 1 stores ``evidence`` opaquely as a JSON-encoded string in DDB —
    queries don't need to peek inside, and JSON encoding sidesteps the
    Decimal-coercion pain of native DDB Maps for arbitrary nested floats.
    """

    proposal_id: str  # UUID v4 hex
    status: str  # one of PROPOSAL_STATUS_VALUES
    created_at: str  # ISO-8601 UTC, doubles as GSI sort key
    created_by_job: str  # e.g. "weekly-proposer-2026-W19"

    # Baseline parameters this rotation was computed against (for traceability).
    baseline_parameter_version: str

    # Per-mode override blocks (JSON-serializable dicts).
    proposed_swing_composite: dict[str, Any] | None
    proposed_day_composite: dict[str, Any] | None

    # Train/validation windows (ISO-8601 UTC, half-open intervals).
    train_window_start: str
    train_window_end: str
    val_window_start: str
    val_window_end: str

    # Justifying evidence (see docstring for shape contract).
    evidence: dict[str, Any]

    # Review state (set when admin promotes/rejects).
    reviewed_at: str | None = None
    reviewed_by: str | None = None
    review_note: str | None = None
    promoted_to_version: str | None = None

    # DynamoDB TTL (epoch seconds). Set for rejected/superseded rows.
    ttl: int | None = None

    @staticmethod
    def new_pending(
        *,
        baseline_parameter_version: str,
        proposed_swing_composite: dict[str, Any] | None,
        proposed_day_composite: dict[str, Any] | None,
        train_window_start: str,
        train_window_end: str,
        val_window_start: str,
        val_window_end: str,
        evidence: dict[str, Any],
        created_by_job: str,
        created_at: str | None = None,
        proposal_id: str | None = None,
    ) -> "ParameterProposal":
        """Factory for a new pending proposal.

        Validates that at least one per-mode override is non-``None`` — a
        proposal with neither side filled in carries no actionable information
        and would just clutter the pending queue.

        ``proposal_id`` / ``created_at`` are normally auto-generated; tests
        inject deterministic values for assertion stability.
        """
        if proposed_swing_composite is None and proposed_day_composite is None:
            raise ValueError(
                "ParameterProposal must propose at least one per-mode override block "
                "(swing or day); a proposal with neither carries no information."
            )
        return ParameterProposal(
            proposal_id=proposal_id or uuid.uuid4().hex,
            status=PROPOSAL_STATUS_PENDING,
            created_at=created_at or datetime.now(timezone.utc).isoformat(),
            created_by_job=created_by_job,
            baseline_parameter_version=baseline_parameter_version,
            proposed_swing_composite=proposed_swing_composite,
            proposed_day_composite=proposed_day_composite,
            train_window_start=train_window_start,
            train_window_end=train_window_end,
            val_window_start=val_window_start,
            val_window_end=val_window_end,
            evidence=evidence,
        )

    def to_item(self) -> dict[str, Any]:
        """Encode this proposal as a DynamoDB row.

        Nested dicts (``evidence`` / proposed composite blocks) are JSON-encoded
        as strings rather than stored as native DDB Maps. Two reasons:

        1. **No Decimal coercion** — boto3 turns every native DDB float into a
           ``decimal.Decimal`` on read, which forces every downstream consumer
           to either cast or carry the type. Storing as JSON sidesteps this.
        2. **Audit-friendliness** — operators reading the row in the AWS
           console see the proposal payload verbatim, not a pretty-printed
           tree of nested Maps.
        """
        item: dict[str, Any] = {
            "proposal_id": self.proposal_id,
            "status": self.status,
            "created_at": self.created_at,
            "created_by_job": self.created_by_job,
            "baseline_parameter_version": self.baseline_parameter_version,
            "train_window_start": self.train_window_start,
            "train_window_end": self.train_window_end,
            "val_window_start": self.val_window_start,
            "val_window_end": self.val_window_end,
            "evidence": json.dumps(self.evidence, sort_keys=True),
        }
        if self.proposed_swing_composite is not None:
            item["proposed_swing_composite"] = json.dumps(
                self.proposed_swing_composite, sort_keys=True
            )
        if self.proposed_day_composite is not None:
            item["proposed_day_composite"] = json.dumps(
                self.proposed_day_composite, sort_keys=True
            )
        if self.reviewed_at is not None:
            item["reviewed_at"] = self.reviewed_at
        if self.reviewed_by is not None:
            item["reviewed_by"] = self.reviewed_by
        if self.review_note is not None:
            item["review_note"] = self.review_note
        if self.promoted_to_version is not None:
            item["promoted_to_version"] = self.promoted_to_version
        if self.ttl is not None:
            item["ttl"] = int(self.ttl)
        return item

    @staticmethod
    def from_item(item: dict[str, Any]) -> "ParameterProposal":
        """Decode a DynamoDB row back to a :class:`ParameterProposal`.

        Tolerates both the JSON-encoded-string and native-dict shapes for the
        nested fields — JSON-encoded is what :meth:`to_item` produces, but a
        test fixture that puts a raw dict on the row should still round-trip.
        """

        def _opt_json(key: str) -> dict[str, Any] | None:
            raw = item.get(key)
            if raw is None or raw == "":
                return None
            if isinstance(raw, dict):
                return raw
            return json.loads(str(raw))

        def _opt_str(key: str) -> str | None:
            v = item.get(key)
            return None if v is None or v == "" else str(v)

        return ParameterProposal(
            proposal_id=str(item["proposal_id"]),
            status=str(item["status"]),
            created_at=str(item["created_at"]),
            created_by_job=str(item.get("created_by_job", "")),
            baseline_parameter_version=str(item.get("baseline_parameter_version", "")),
            proposed_swing_composite=_opt_json("proposed_swing_composite"),
            proposed_day_composite=_opt_json("proposed_day_composite"),
            train_window_start=str(item.get("train_window_start", "")),
            train_window_end=str(item.get("train_window_end", "")),
            val_window_start=str(item.get("val_window_start", "")),
            val_window_end=str(item.get("val_window_end", "")),
            evidence=_opt_json("evidence") or {},
            reviewed_at=_opt_str("reviewed_at"),
            reviewed_by=_opt_str("reviewed_by"),
            review_note=_opt_str("review_note"),
            promoted_to_version=_opt_str("promoted_to_version"),
            ttl=int(item["ttl"]) if "ttl" in item and item["ttl"] is not None else None,
        )


class ParameterProposalStore:
    """CRUD operations for the ``ParameterProposal`` DDB table.

    Constructor accepts an injected ``table`` for tests; production code uses
    :func:`build_default_proposal_store` to get a real boto3 Table. The
    interface deliberately matches the small subset of boto3 Table operations
    we need (``put_item``, ``get_item``, ``query``, ``update_item``), so tests
    can substitute a ``_FakeTable`` like the journal-store tests do.
    """

    def __init__(self, table: Any) -> None:
        self._table = table

    # ── Writes ────────────────────────────────────────────────────────────

    def put(self, proposal: ParameterProposal) -> None:
        """Idempotent write — overwrites any existing row with the same id.

        The optimizer should not produce duplicate ids in normal operation,
        but idempotency makes retry-safety trivial: if the Lambda is invoked
        twice for the same proposal_id (e.g. EventBridge retry on a failed
        DDB write), the second put just overwrites the partial first put with
        the complete row.
        """
        self._table.put_item(Item=proposal.to_item())

    # ── Reads ─────────────────────────────────────────────────────────────

    def get(self, proposal_id: str) -> ParameterProposal | None:
        """Fetch one proposal by id. Returns ``None`` if not found."""
        result = self._table.get_item(Key={"proposal_id": proposal_id})
        item = result.get("Item")
        if item is None:
            return None
        return ParameterProposal.from_item(item)

    def list_by_status(
        self, status: str, *, limit: int = 20
    ) -> list[ParameterProposal]:
        """List proposals for one status, sorted by ``created_at`` DESC.

        Validates ``status`` against the closed-set
        :data:`PROPOSAL_STATUS_VALUES` so a typo (``"pendng"``) raises loud
        instead of silently returning ``[]`` from a DDB query that finds
        nothing.

        Uses the ``status_index`` GSI configured in ``infra/dynamodb.tf``.
        """
        if status not in PROPOSAL_STATUS_VALUES:
            raise ValueError(
                f"Invalid status {status!r}; must be one of {PROPOSAL_STATUS_VALUES}"
            )
        result = self._table.query(
            IndexName=GSI_STATUS_INDEX,
            KeyConditionExpression=Key("status").eq(status),
            ScanIndexForward=False,  # DESC by created_at (newest first)
            Limit=int(limit),
        )
        return [ParameterProposal.from_item(it) for it in result.get("Items", [])]

    # ── Status transitions ────────────────────────────────────────────────

    def mark_promoted(
        self,
        proposal_id: str,
        *,
        reviewed_at: str,
        reviewed_by: str,
        promoted_to_version: str,
    ) -> ParameterProposal:
        """Atomic transition ``pending → promoted``.

        Raises :class:`ValueError` if the proposal does not exist OR is not
        currently in ``pending`` state. This is the load-bearing guarantee
        that a rejected/superseded proposal cannot be silently promoted by a
        racing admin click.
        """
        return self._transition_status(
            proposal_id,
            from_status=PROPOSAL_STATUS_PENDING,
            to_status=PROPOSAL_STATUS_PROMOTED,
            extra_updates={
                "reviewed_at": reviewed_at,
                "reviewed_by": reviewed_by,
                "promoted_to_version": promoted_to_version,
            },
        )

    def mark_rejected(
        self,
        proposal_id: str,
        *,
        reviewed_at: str,
        reviewed_by: str,
        review_note: str | None = None,
    ) -> ParameterProposal:
        """Atomic transition ``pending → rejected``.

        Stamps a TTL ``PROPOSAL_TTL_DAYS`` from now so the row auto-expires
        and doesn't pile up. Promoted rows deliberately have no TTL.
        """
        ttl_epoch = int(time.time() + PROPOSAL_TTL_DAYS * 86400)
        extra: dict[str, Any] = {
            "reviewed_at": reviewed_at,
            "reviewed_by": reviewed_by,
            "ttl": ttl_epoch,
        }
        if review_note:
            extra["review_note"] = review_note
        return self._transition_status(
            proposal_id,
            from_status=PROPOSAL_STATUS_PENDING,
            to_status=PROPOSAL_STATUS_REJECTED,
            extra_updates=extra,
        )

    def mark_superseded(
        self,
        proposal_id: str,
        *,
        superseded_at: str,
        superseded_by_proposal_id: str,
    ) -> ParameterProposal:
        """Atomic transition ``pending → superseded``.

        Called by the Phase-3 admin endpoint when a newer pending proposal is
        promoted: any older pending proposal becomes irrelevant and is
        auto-superseded so the pending queue doesn't grow stale.
        """
        ttl_epoch = int(time.time() + PROPOSAL_TTL_DAYS * 86400)
        return self._transition_status(
            proposal_id,
            from_status=PROPOSAL_STATUS_PENDING,
            to_status=PROPOSAL_STATUS_SUPERSEDED,
            extra_updates={
                "reviewed_at": superseded_at,
                "review_note": f"superseded_by:{superseded_by_proposal_id}",
                "ttl": ttl_epoch,
            },
        )

    # ── Internal ──────────────────────────────────────────────────────────

    def _transition_status(
        self,
        proposal_id: str,
        *,
        from_status: str,
        to_status: str,
        extra_updates: dict[str, Any],
    ) -> ParameterProposal:
        """Conditional update gated on the current status.

        ``status`` is a DDB reserved word, hence the ``#st`` attribute-name
        placeholder. The condition ``#st = :expected`` is what makes the
        transition atomic — DDB will reject the update if the row's status
        has changed since the caller's last read.
        """
        update_expr_parts = ["#st = :new_status"]
        attr_names: dict[str, str] = {"#st": "status"}
        attr_values: dict[str, Any] = {
            ":new_status": to_status,
            ":expected": from_status,
        }
        for key, val in extra_updates.items():
            placeholder_n = f"#u_{key}"
            placeholder_v = f":u_{key}"
            update_expr_parts.append(f"{placeholder_n} = {placeholder_v}")
            attr_names[placeholder_n] = key
            attr_values[placeholder_v] = val

        try:
            result = self._table.update_item(
                Key={"proposal_id": proposal_id},
                UpdateExpression="SET " + ", ".join(update_expr_parts),
                ConditionExpression="#st = :expected",
                ExpressionAttributeNames=attr_names,
                ExpressionAttributeValues=attr_values,
                ReturnValues="ALL_NEW",
            )
        except ClientError as exc:
            code = exc.response.get("Error", {}).get("Code", "")
            if code == "ConditionalCheckFailedException":
                raise ValueError(
                    f"Proposal {proposal_id!r} is not in status {from_status!r}; "
                    f"cannot transition to {to_status!r}"
                ) from exc
            raise

        item = result.get("Attributes", {})
        return ParameterProposal.from_item(item)


def build_default_proposal_store() -> ParameterProposalStore:
    """Build a :class:`ParameterProposalStore` backed by the production DDB table.

    Raises :class:`ValueError` when the table env var is unset — Phase 1 ships
    dark, so callers should not invoke this in production paths yet. Once
    Phase 2's optimizer Lambda is wired and Terraform is applied, this becomes
    the canonical accessor.
    """
    settings = get_settings()
    name = (settings.dynamodb_parameter_proposal_table or "").strip()
    if not name:
        raise ValueError(
            "DYNAMODB_PARAMETER_PROPOSAL_TABLE must be set; apply Terraform "
            "before invoking the parameter-proposal store."
        )
    kwargs: dict[str, Any] = {}
    if settings.dynamodb_endpoint_url:
        kwargs["endpoint_url"] = settings.dynamodb_endpoint_url
    dynamodb = boto3.resource("dynamodb", region_name=settings.aws_region, **kwargs)
    return ParameterProposalStore(table=dynamodb.Table(name))
