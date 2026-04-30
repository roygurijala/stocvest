"""Push JSON to WebSocket clients subscribed to scanner updates (API Gateway Management API)."""

from __future__ import annotations

import json
from typing import Any

from stocvest.api.services.ws_connection_index import list_scanner_update_subscribers
from stocvest.utils.config import get_settings
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)


def broadcast_scanner_payload(payload: dict[str, Any]) -> int:
    """Post ``payload`` to subscribers; returns count of successful posts."""
    settings = get_settings()
    base = settings.websocket_management_api_url.strip()
    if not base:
        return 0
    connection_ids = list_scanner_update_subscribers()
    if not connection_ids:
        return 0
    endpoint = base.rstrip("/")
    import boto3
    from botocore.exceptions import ClientError

    client = boto3.client(
        "apigatewaymanagementapi",
        endpoint_url=endpoint,
        region_name=settings.aws_region,
    )
    body = json.dumps(payload, separators=(",", ":"), default=str).encode("utf-8")
    sent = 0
    for cid in connection_ids:
        try:
            client.post_to_connection(ConnectionId=cid, Data=body)
            sent += 1
        except ClientError as exc:
            code = exc.response.get("Error", {}).get("Code", "")
            if code in {"GoneException", "410"}:
                _LOG.debug("websocket connection gone connection_id=%s", cid)
            else:
                _LOG.warning("websocket post failed connection_id=%s error=%s", cid, exc)
        except Exception as exc:
            _LOG.warning("websocket post failed connection_id=%s error=%s", cid, exc)
    return sent
