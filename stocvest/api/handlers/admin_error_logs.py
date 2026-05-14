"""Admin CloudWatch error log viewer (read-only).

``GET /v1/admin/error-logs`` — runs a bounded CloudWatch Logs Insights query
across API Lambda log groups whose names match a configured prefix, defaulting
to the same ``/aws/lambda/stocvest-<env>-api-`` convention as ``infra/lambda_6e.tf``.

Requires the same admin gate as other admin read surfaces
(:func:`stocvest.api.services.signal_analysis.analysis_authorized`).
"""

from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone
from typing import Any, Protocol, runtime_checkable

from botocore.exceptions import ClientError

import boto3

from stocvest.api.response import bad_request, forbidden, internal_error, ok
from stocvest.api.services.signal_analysis import analysis_authorized
from stocvest.api.shared import build_request_context
from stocvest.api.types import LambdaContext, LambdaEvent
from stocvest.utils.config import get_settings
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

_DEFAULT_DAYS = 7
_MAX_DAYS = 14
_DEFAULT_LIMIT = 300
_MAX_LIMIT = 500
_MAX_LOG_GROUPS_PER_QUERY = 50
_MAX_MESSAGE_CHARS = 8000
_POLL_INTERVAL_SEC = 0.35
_MAX_POLL_ROUNDS = 50

# Matches common Lambda error signatures without pulling routine access logs.
_CWLI_ERROR_FILTER = r"""fields @timestamp, @logGroup, @message
| filter @message like /ERROR|Error:|Exception|Traceback|Task timed out|Runtime\\.UserCodeSyntaxError|Unhandled/
| sort @timestamp desc
| limit LIMIT_PLACEHOLDER"""


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


def _effective_log_group_prefix(settings: Any) -> str:
    explicit = str(getattr(settings, "cloudwatch_admin_error_log_group_prefix", "") or "").strip()
    if explicit:
        return explicit
    env = str(getattr(settings, "env", "") or "development").strip() or "development"
    return f"/aws/lambda/stocvest-{env}-api-"


@runtime_checkable
class _LogsClient(Protocol):
    def describe_log_groups(
        self, *, logGroupNamePrefix: str, limit: int, nextToken: str | None = None
    ) -> dict[str, Any]: ...

    def start_query(
        self,
        *,
        logGroupNames: list[str],
        startTime: int,
        endTime: int,
        queryString: str,
    ) -> dict[str, Any]: ...

    def get_query_results(self, *, queryId: str) -> dict[str, Any]: ...


def _list_log_group_names(client: _LogsClient, prefix: str) -> list[str]:
    names: list[str] = []
    token: str | None = None
    while len(names) < _MAX_LOG_GROUPS_PER_QUERY:
        kwargs: dict[str, Any] = {"logGroupNamePrefix": prefix, "limit": 50}
        if token:
            kwargs["nextToken"] = token
        resp = client.describe_log_groups(**kwargs)
        for g in resp.get("logGroups") or []:
            if isinstance(g, dict):
                n = str(g.get("logGroupName") or "").strip()
                if n and n not in names:
                    names.append(n)
        token = resp.get("nextToken")
        if not token:
            break
    names.sort()
    return names[:_MAX_LOG_GROUPS_PER_QUERY]


def _run_insights_query(
    client: _LogsClient,
    *,
    log_group_names: list[str],
    start_ms: int,
    end_ms: int,
    limit: int,
) -> tuple[list[dict[str, Any]], dict[str, Any], str | None]:
    if not log_group_names:
        return [], {}, None
    q = _CWLI_ERROR_FILTER.replace("LIMIT_PLACEHOLDER", str(max(1, min(_MAX_LIMIT, limit))))
    try:
        start_resp = client.start_query(
            logGroupNames=log_group_names,
            startTime=start_ms // 1000,
            endTime=end_ms // 1000,
            queryString=q,
        )
    except ClientError as exc:
        code = str((exc.response or {}).get("Error", {}).get("Code", ""))
        msg = str((exc.response or {}).get("Error", {}).get("Message", "") or exc)
        _LOG.warning("StartQuery failed: %s %s", code, msg)
        return [], {}, f"{code}: {msg}"

    qid = str(start_resp.get("queryId") or "").strip()
    if not qid:
        return [], {}, "StartQuery returned no queryId"

    stats: dict[str, Any] = {}
    for _ in range(_MAX_POLL_ROUNDS):
        res = client.get_query_results(queryId=qid)
        status = str(res.get("status") or "")
        stats = res.get("statistics") if isinstance(res.get("statistics"), dict) else {}
        if status in ("Complete", "Failed", "Cancelled", "Timeout"):
            if status != "Complete":
                return [], stats, f"Insights query {status}"
            break
        time.sleep(_POLL_INTERVAL_SEC)
    else:
        try:
            client.get_query_results  # pragma: no cover
        except Exception:
            pass
        return [], stats, "Insights query poll timeout"

    rows_out: list[dict[str, Any]] = []
    for row in res.get("results") or []:
        if not isinstance(row, list):
            continue
        m = {str(c.get("field")): str(c.get("value") or "") for c in row if isinstance(c, dict)}
        ts = m.get("@timestamp", "")
        lg = m.get("@logGroup", "")
        msg = m.get("@message", "")
        if len(msg) > _MAX_MESSAGE_CHARS:
            msg = msg[: _MAX_MESSAGE_CHARS] + "…(truncated)"
        rows_out.append({"timestamp": ts, "log_group": lg, "message": msg})
    return rows_out, stats, None


def admin_error_logs_recent_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    """``GET /v1/admin/error-logs?days=7&limit=300`` — recent Lambda errors via Insights."""
    _ = context
    deny = _require_admin(event)
    if deny is not None:
        return deny

    qs = _query_params(event)
    try:
        days = int(qs.get("days") or _DEFAULT_DAYS)
    except ValueError:
        return bad_request("days must be an integer.")
    days = max(1, min(_MAX_DAYS, days))

    try:
        limit = int(qs.get("limit") or _DEFAULT_LIMIT)
    except ValueError:
        return bad_request("limit must be an integer.")
    limit = max(1, min(_MAX_LIMIT, limit))

    settings = get_settings()
    prefix = _effective_log_group_prefix(settings)
    region = str(getattr(settings, "aws_region", "") or "us-east-1").strip() or "us-east-1"

    try:
        client = boto3.client("logs", region_name=region)
    except Exception as exc:  # pragma: no cover
        _LOG.exception("boto3 logs client init failed: %s", exc)
        return internal_error("Failed to initialize CloudWatch Logs client.")

    try:
        log_names = _list_log_group_names(client, prefix)
    except ClientError as exc:
        code = str((exc.response or {}).get("Error", {}).get("Code", ""))
        if code == "AccessDeniedException":
            return forbidden("CloudWatch Logs access denied for this identity.")
        _LOG.warning("describe_log_groups failed: %s", exc)
        return internal_error("Failed to list log groups.")

    end = datetime.now(timezone.utc)
    start = end - timedelta(days=days)
    start_ms = int(start.timestamp() * 1000)
    end_ms = int(end.timestamp() * 1000)

    items, stats, err = _run_insights_query(
        client, log_group_names=log_names, start_ms=start_ms, end_ms=end_ms, limit=limit
    )
    if err:
        _LOG.warning("admin error logs query: %s", err)
        return ok(
            {
                "days": days,
                "limit": limit,
                "log_group_prefix": prefix,
                "log_groups": log_names,
                "window_start": start.isoformat(),
                "window_end": end.isoformat(),
                "items": [],
                "statistics": stats,
                "query_error": err,
            }
        )

    return ok(
        {
            "days": days,
            "limit": limit,
            "log_group_prefix": prefix,
            "log_groups": log_names,
            "window_start": start.isoformat(),
            "window_end": end.isoformat(),
            "items": items,
            "statistics": stats,
            "query_error": None,
        }
    )
