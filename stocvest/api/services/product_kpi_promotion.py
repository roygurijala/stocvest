"""Apply Product KPI promotion verdicts to the live parameter store."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from stocvest.api.services.historical_validation_service import HistoricalValidationService
from stocvest.api.services.proposal_review import promote_proposal
from stocvest.config.parameter_store import ParameterStore
from stocvest.data.parameter_proposal_store import ParameterProposalStore
from stocvest.signals.historical_validation import Horizon
from stocvest.signals.product_kpi import (
    PRODUCT_KPI_DEFAULT_WINDOW_DAYS,
    evaluate_version_promotion,
    promotion_verdict_to_dict,
    summarize_product_kpi_by_version,
)
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)


@dataclass(frozen=True)
class ApplyPromotionResult:
    success: bool
    action: str
    promotion: dict[str, Any]
    new_parameter_version: str | None = None
    proposal_id: str | None = None
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "success": self.success,
            "action": self.action,
            "promotion": self.promotion,
            "new_parameter_version": self.new_parameter_version,
            "proposal_id": self.proposal_id,
            "error": self.error,
        }


def apply_product_kpi_promotion(
    *,
    prior_version: str,
    candidate_version: str,
    proposal_id: str,
    reviewed_by: str,
    recorder: Any,
    from_at: datetime,
    to_at: datetime,
    horizon: Horizon = "1d",
    proposal_store: ParameterProposalStore | None = None,
) -> ApplyPromotionResult:
    """Run KPI gates, then promote a pending D10 proposal to live."""

    prior_key = prior_version.strip()
    candidate_key = candidate_version.strip()
    pid = proposal_id.strip()
    if not prior_key or not candidate_key or not pid:
        return ApplyPromotionResult(
            success=False,
            action="none",
            promotion={},
            error="prior_version, candidate_version, and proposal_id are required",
        )

    service = HistoricalValidationService(recorder)
    rows = service.fetch_backtest_window(
        scope="public",
        from_at=from_at,
        to_at=to_at,
        mode=None,
        user_id=None,
    )
    per = summarize_product_kpi_by_version(
        rows, horizon=horizon, from_at=from_at, to_at=to_at
    )
    prior = per.get(prior_key)
    candidate = per.get(candidate_key)
    if prior is None or candidate is None:
        return ApplyPromotionResult(
            success=False,
            action="none",
            promotion={},
            error="prior or candidate version not found in product KPI window",
        )

    verdict = evaluate_version_promotion(candidate=candidate, prior=prior)
    promotion_dict = promotion_verdict_to_dict(verdict)
    if not verdict.promoted:
        return ApplyPromotionResult(
            success=False,
            action="kpi_rejected",
            promotion=promotion_dict,
            error="; ".join(verdict.reasons) or "product KPI promotion gates failed",
        )

    store = proposal_store or ParameterProposalStore()
    live = ParameterStore.get_parameters_sync()
    proposal = store.get(pid)
    if proposal is None:
        return ApplyPromotionResult(
            success=False,
            action="kpi_passed",
            promotion=promotion_dict,
            error=f"proposal not found: {pid}",
        )
    baseline = (proposal.baseline_parameter_version or "").strip()
    allowed = {prior_key, str(live.version or "").strip()}
    if baseline and baseline not in allowed:
        return ApplyPromotionResult(
            success=False,
            action="kpi_passed",
            promotion=promotion_dict,
            error=(
                f"proposal baseline {baseline!r} must match prior {prior_key!r} "
                f"or live {live.version!r}"
            ),
        )

    result = promote_proposal(pid, reviewed_by=reviewed_by, proposal_store=store)
    if not result.success:
        return ApplyPromotionResult(
            success=False,
            action="promote_proposal_failed",
            promotion=promotion_dict,
            proposal_id=pid,
            error=result.error or "promote_proposal failed",
        )

    return ApplyPromotionResult(
        success=True,
        action="promote_proposal",
        promotion=promotion_dict,
        proposal_id=pid,
        new_parameter_version=result.new_parameter_version,
    )


def proposals_matching_prior(
    proposals: list[Any],
    *,
    prior_version: str,
    live_version: str | None = None,
) -> list[Any]:
    """Pending proposals whose baseline matches prior or current live version."""

    prior = prior_version.strip()
    live = (live_version or "").strip()
    out: list[Any] = []
    for proposal in proposals:
        baseline = str(getattr(proposal, "baseline_parameter_version", "") or "").strip()
        if baseline == prior or (live and baseline == live):
            out.append(proposal)
    return out


def default_promotion_window() -> tuple[datetime, datetime]:
    now = datetime.now(timezone.utc)
    from_at = now - timedelta(days=PRODUCT_KPI_DEFAULT_WINDOW_DAYS)
    return from_at, now
