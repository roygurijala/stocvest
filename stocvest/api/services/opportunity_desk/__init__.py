"""Opportunity Desk — full-market funnel and discovery snapshot helpers."""

from stocvest.api.services.opportunity_desk.batch import (
    run_opportunity_desk_batch,
    run_opportunity_desk_batch_sync,
)
from stocvest.api.services.opportunity_desk.funnel import (
    DeskSnapshotDiff,
    OpportunityDeskFunnelConfig,
    OpportunityDeskFunnelResult,
    diff_desk_snapshots,
    run_snapshot_funnel,
)

__all__ = [
    "DeskSnapshotDiff",
    "OpportunityDeskFunnelConfig",
    "OpportunityDeskFunnelResult",
    "diff_desk_snapshots",
    "run_opportunity_desk_batch",
    "run_opportunity_desk_batch_sync",
    "run_snapshot_funnel",
]
