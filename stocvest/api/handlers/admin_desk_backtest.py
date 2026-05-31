"""Admin desk backtesting — product success + environment policy replay.

Routes (all admin-gated via ``analysis_authorized``):

* ``GET /v1/admin/historical-validation/summary`` — full D2 stratification over the
  platform PUBLIC ledger (``user_id=None``) or the caller's tracked scope
  (``scope=mine``).
* ``GET /v1/admin/environment-policy/backtest`` — grid-search VIX enter bands against
  stored ``market_environment_audit`` rows (no bar replay, no hysteresis).
* ``GET /v1/admin/product-kpi/summary`` — official product KPI (qualified + actionable
  cohort only) with coverage, decision frontier, and optional version promotion.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from stocvest.api.handlers.signals import (
    HISTORICAL_VALIDATION_DISCLAIMER,
    _parse_horizon,
    _parse_iso_datetime,
    _summary_to_dict,
)
from stocvest.api.response import bad_request, forbidden, internal_error, json_response, ok
from stocvest.api.services.historical_validation_service import (
    ALL_VERSIONS_KEY,
    MAX_LOOKBACK_DAYS,
    HistoricalValidationService,
    _version_key,
)
from stocvest.signals.historical_validation import validate_signal_history
from stocvest.api.services.signal_analysis import analysis_authorized
from stocvest.api.services.signal_recorder import get_signal_recorder
from stocvest.api.shared import build_request_context, parse_json_body
from stocvest.api.types import LambdaContext, LambdaEvent
from stocvest.signals.environment_policy_backtest import (
    PRODUCTION_BANDS,
    candidate_metrics_to_dict,
    extract_backtest_rows,
    rank_candidates,
    run_grid_search,
)
from stocvest.signals.product_kpi import (
    PRODUCT_KPI_DEFAULT_WINDOW_DAYS,
    evaluate_version_promotion,
    product_kpi_summary_to_dict,
    promotion_verdict_to_dict,
    summarize_product_kpi,
    summarize_product_kpi_by_version,
)
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

_ENVIRONMENT_BACKTEST_DISCLAIMER = (
    "Environment policy replay uses stored VIX audit fields from real ledger rows. "
    "Hysteresis is not simulated; use results to tune enter bands only."
)

_DEFAULT_BACKTEST_DAYS = 180
_DEFAULT_TOP_CANDIDATES = 20
_MAX_TOP_CANDIDATES = 60


def _query_params(event: LambdaEvent) -> dict[str, str]:
    raw = event.get("queryStringParameters") or {}
    if not isinstance(raw, dict):
        return {}
    return {str(k): str(v) for k, v in raw.items() if v is not None}


def _require_admin(event: LambdaEvent) -> dict[str, Any] | None:
    rc = build_request_context(event)
    headers = event.get("headers") or {}
    if not isinstance(headers, dict):
        headers = {}
    if analysis_authorized(user_id=rc.user_id, claims=rc.claims, headers=headers):
        return None
    return forbidden("Admin authorization required.")


def admin_historical_validation_summary_handler(
    event: LambdaEvent,
    context: LambdaContext,
) -> dict[str, Any]:
    """``GET /v1/admin/historical-validation/summary`` — admin D2 over PUBLIC or mine."""
    _ = context
    deny = _require_admin(event)
    if deny is not None:
        return deny

    rc = build_request_context(event)
    qs = _query_params(event)

    horizon = _parse_horizon(qs)
    if horizon is None:
        return bad_request("horizon must be '1h' or '1d'.")

    from_at = _parse_iso_datetime(qs.get("from"))
    to_at = _parse_iso_datetime(qs.get("to"))
    if from_at is None or to_at is None:
        return bad_request("from and to must be ISO-8601 datetimes.")
    if to_at <= from_at:
        return bad_request("to must be strictly after from.")

    mode_raw = str(qs.get("mode") or "").strip().lower()
    mode_filter: str | None = mode_raw if mode_raw in ("day", "swing") else None

    symbol_raw = str(qs.get("symbol") or "").strip().upper()
    symbol_filter: str | None = symbol_raw or None

    scope_raw = str(qs.get("scope") or "public").strip().lower()
    if scope_raw in ("mine", "user", "self"):
        scope_label = "mine"
    elif scope_raw == "all":
        scope_label = "all"
    else:
        scope_label = "public"

    by_version_raw = str(qs.get("by_version") or "").strip().lower()
    by_version = by_version_raw in ("1", "true", "yes")

    try:
        service = HistoricalValidationService(get_signal_recorder())
        body: dict[str, Any] = {
            "horizon": horizon,
            "from": from_at.isoformat(),
            "to": to_at.isoformat(),
            "mode": mode_filter,
            "symbol": symbol_filter,
            "scope": scope_label,
            "disclaimer": HISTORICAL_VALIDATION_DISCLAIMER,
        }
        if by_version:
            rows = service.fetch_backtest_window(
                scope=scope_label,
                from_at=from_at,
                to_at=to_at,
                mode=mode_filter,
                user_id=rc.user_id,
            )
            if symbol_filter:
                rows = [r for r in rows if r.symbol.upper() == symbol_filter]
            per_version: dict[str, list] = {}
            for row in rows:
                key = _version_key(row.parameter_version)
                per_version.setdefault(key, []).append(row)
            result_map = {
                ALL_VERSIONS_KEY: validate_signal_history(rows, horizon=horizon),
            }
            for version, version_rows in per_version.items():
                result_map[version] = validate_signal_history(version_rows, horizon=horizon)
            body["by_parameter_version"] = {
                version: _summary_to_dict(summary) for version, summary in result_map.items()
            }
        else:
            summary = service.summarize_backtest(
                scope=scope_label,
                from_at=from_at,
                to_at=to_at,
                horizon=horizon,
                mode=mode_filter,
                symbol=symbol_filter,
                user_id=rc.user_id,
            )
            body["summary"] = _summary_to_dict(summary)
        return ok(body)
    except Exception as exc:  # pragma: no cover — defensive
        _LOG.exception("admin_historical_validation_summary failed: %s", exc)
        return internal_error("Admin historical validation summary failed.")


def admin_environment_policy_backtest_handler(
    event: LambdaEvent,
    context: LambdaContext,
) -> dict[str, Any]:
    """``GET /v1/admin/environment-policy/backtest`` — VIX enter-band grid replay."""
    _ = context
    deny = _require_admin(event)
    if deny is not None:
        return deny

    qs = _query_params(event)
    horizon = _parse_horizon(qs)
    if horizon is None:
        horizon = "1d"

    mode_raw = str(qs.get("mode") or "swing").strip().lower()
    if mode_raw not in ("swing", "day", "all"):
        return bad_request("mode must be swing, day, or all.")
    mode_filter = None if mode_raw == "all" else mode_raw
    desk_mode: str = "swing" if mode_raw == "all" else mode_raw

    try:
        days = int(qs.get("days") or _DEFAULT_BACKTEST_DAYS)
    except ValueError:
        return bad_request("days must be an integer.")
    days = max(1, min(MAX_LOOKBACK_DAYS, days))

    try:
        top = int(qs.get("top") or _DEFAULT_TOP_CANDIDATES)
    except ValueError:
        return bad_request("top must be an integer.")
    top = max(1, min(_MAX_TOP_CANDIDATES, top))

    from_at = _parse_iso_datetime(qs.get("from"))
    to_at = _parse_iso_datetime(qs.get("to"))
    now = datetime.now(timezone.utc)
    if from_at is None and to_at is None:
        to_at = now
        from_at = now - timedelta(days=days)
    elif from_at is None or to_at is None:
        return bad_request("from and to must be supplied together, or both omitted.")
    elif to_at <= from_at:
        return bad_request("to must be strictly after from.")

    scope_raw = str(qs.get("scope") or "public").strip().lower()
    scope_label = "all" if scope_raw == "all" else ("mine" if scope_raw in ("mine", "user", "self") else "public")

    try:
        rc = build_request_context(event)
        service = HistoricalValidationService(get_signal_recorder())
        records = service.fetch_backtest_window(
            scope=scope_label,
            from_at=from_at,
            to_at=to_at,
            mode=mode_filter,
            user_id=rc.user_id,
        )
        rows = extract_backtest_rows(records)
        if mode_filter:
            rows = [r for r in rows if r.mode == mode_filter]

        if not rows:
            return ok(
                {
                    "horizon": horizon,
                    "mode": mode_raw,
                    "days": days,
                    "from": from_at.isoformat(),
                    "to": to_at.isoformat(),
                    "rows_total": 0,
                    "rows_with_vix": 0,
                    "production_bands": {
                        "normal_enter": PRODUCTION_BANDS.normal_enter,
                        "elevated_enter": PRODUCTION_BANDS.elevated_enter,
                        "crisis_enter": PRODUCTION_BANDS.crisis_enter,
                    },
                    "candidates": [],
                    "ranked_count": 0,
                    "disclaimer": _ENVIRONMENT_BACKTEST_DISCLAIMER,
                }
            )

        results = run_grid_search(rows, horizon=horizon)  # type: ignore[arg-type]
        ranked = rank_candidates(results, mode=desk_mode)  # type: ignore[arg-type]

        return ok(
            {
                "horizon": horizon,
                "mode": mode_raw,
                "days": days,
                "from": from_at.isoformat(),
                "to": to_at.isoformat(),
                "rows_total": len(rows),
                "rows_with_vix": sum(1 for r in rows if r.vix_level is not None),
                "production_bands": {
                    "normal_enter": PRODUCTION_BANDS.normal_enter,
                    "elevated_enter": PRODUCTION_BANDS.elevated_enter,
                    "crisis_enter": PRODUCTION_BANDS.crisis_enter,
                },
                "candidates": [candidate_metrics_to_dict(m) for m in ranked[:top]],
                "ranked_count": len(ranked),
                "disclaimer": _ENVIRONMENT_BACKTEST_DISCLAIMER,
            }
        )
    except Exception as exc:  # pragma: no cover — defensive
        _LOG.exception("admin_environment_policy_backtest failed: %s", exc)
        return internal_error("Environment policy backtest failed.")


_PRODUCT_KPI_DISCLAIMER = (
    "Product KPI measures qualified, actionable, ledger-approved signals only. "
    "Shadow and monitor rows are excluded. Headline accuracy requires a minimum "
    "resolved non-neutral sample. Historical signal accuracy does not guarantee "
    "future results."
)


def admin_product_kpi_summary_handler(
    event: LambdaEvent,
    context: LambdaContext,
) -> dict[str, Any]:
    """``GET /v1/admin/product-kpi/summary`` — canonical product success scorecard."""
    _ = context
    deny = _require_admin(event)
    if deny is not None:
        return deny

    rc = build_request_context(event)
    qs = _query_params(event)

    horizon = _parse_horizon(qs)
    if horizon is None:
        horizon = "1d"

    from_at = _parse_iso_datetime(qs.get("from"))
    to_at = _parse_iso_datetime(qs.get("to"))
    now = datetime.now(timezone.utc)
    if from_at is None and to_at is None:
        try:
            days = int(qs.get("days") or PRODUCT_KPI_DEFAULT_WINDOW_DAYS)
        except ValueError:
            return bad_request("days must be an integer.")
        days = max(1, min(MAX_LOOKBACK_DAYS, days))
        to_at = now
        from_at = now - timedelta(days=days)
    elif from_at is None or to_at is None:
        return bad_request("from and to must be supplied together, or both omitted.")
    elif to_at <= from_at:
        return bad_request("to must be strictly after from.")
    else:
        days = max(1, (to_at - from_at).days)

    mode_raw = str(qs.get("mode") or "").strip().lower()
    mode_filter: str | None = mode_raw if mode_raw in ("day", "swing") else None

    scope_raw = str(qs.get("scope") or "public").strip().lower()
    if scope_raw in ("mine", "user", "self"):
        scope_label = "mine"
    elif scope_raw == "all":
        scope_label = "all"
    else:
        scope_label = "public"

    by_version_raw = str(qs.get("by_version") or "").strip().lower()
    by_version = by_version_raw in ("1", "true", "yes")

    promote_prior = str(qs.get("promote_prior") or "").strip()
    promote_candidate = str(qs.get("promote_candidate") or "").strip()

    try:
        service = HistoricalValidationService(get_signal_recorder())
        rows = service.fetch_backtest_window(
            scope=scope_label,
            from_at=from_at,
            to_at=to_at,
            mode=mode_filter,
            user_id=rc.user_id,
        )
        body: dict[str, Any] = {
            "horizon": horizon,
            "from": from_at.isoformat(),
            "to": to_at.isoformat(),
            "days": days,
            "mode": mode_filter,
            "scope": scope_label,
            "cohort_definition": (
                "capture_kind=qualified AND decision_state_entry=actionable "
                "AND ledger_qualified=true"
            ),
            "disclaimer": _PRODUCT_KPI_DISCLAIMER,
        }
        if by_version:
            per = summarize_product_kpi_by_version(
                rows, horizon=horizon, from_at=from_at, to_at=to_at
            )
            body["by_parameter_version"] = {
                version: product_kpi_summary_to_dict(s) for version, s in per.items()
            }
            if promote_prior and promote_candidate:
                prior = per.get(promote_prior)
                candidate = per.get(promote_candidate)
                if prior and candidate:
                    body["promotion"] = promotion_verdict_to_dict(
                        evaluate_version_promotion(candidate=candidate, prior=prior)
                    )
        else:
            summary = summarize_product_kpi(
                rows, horizon=horizon, from_at=from_at, to_at=to_at
            )
            body["summary"] = product_kpi_summary_to_dict(summary)
        return ok(body)
    except Exception as exc:  # pragma: no cover — defensive
        _LOG.exception("admin_product_kpi_summary failed: %s", exc)
        return internal_error("Product KPI summary failed.")


def admin_product_kpi_apply_promotion_handler(
    event: LambdaEvent,
    context: LambdaContext,
) -> dict[str, Any]:
    """``POST /v1/admin/product-kpi/apply-promotion`` — KPI gates + promote proposal."""
    _ = context
    deny = _require_admin(event)
    if deny is not None:
        return deny

    rc = build_request_context(event)
    try:
        body = parse_json_body(event)
    except (TypeError, ValueError, KeyError):
        return bad_request("Invalid JSON body.")
    if not isinstance(body, dict):
        return bad_request("Body must be a JSON object.")

    prior = str(body.get("prior_version") or "").strip()
    candidate = str(body.get("candidate_version") or "").strip()
    proposal_id = str(body.get("proposal_id") or "").strip()
    if not prior or not candidate or not proposal_id:
        return bad_request("prior_version, candidate_version, and proposal_id are required.")

    horizon = _parse_horizon({"horizon": str(body.get("horizon") or "1d")})
    if horizon is None:
        horizon = "1d"

    from_at = _parse_iso_datetime(body.get("from"))
    to_at = _parse_iso_datetime(body.get("to"))
    if from_at is None or to_at is None:
        from_at, to_at = default_promotion_window()
    elif to_at <= from_at:
        return bad_request("to must be strictly after from.")

    reviewed_by = (rc.user_id or "admin").strip()

    try:
        result = apply_product_kpi_promotion(
            prior_version=prior,
            candidate_version=candidate,
            proposal_id=proposal_id,
            reviewed_by=reviewed_by,
            recorder=get_signal_recorder(),
            from_at=from_at,
            to_at=to_at,
            horizon=horizon,
        )
        if result.success:
            return ok(result.to_dict())
        return json_response(
            400,
            {
                "error": "promotion_rejected",
                "message": result.error or "Product KPI promotion failed.",
                **result.to_dict(),
            },
        )
    except Exception as exc:  # pragma: no cover
        _LOG.exception("admin_product_kpi_apply_promotion failed: %s", exc)
        return internal_error("Product KPI apply promotion failed.")
