"""E*TRADE OAuth start + callback (request/access token exchange)."""

from __future__ import annotations

from typing import Any

from stocvest.api.response import bad_request, internal_error, ok, unauthorized
from stocvest.api.shared import build_request_context, parse_json_body
from stocvest.api.types import LambdaContext, LambdaEvent
from stocvest.brokers.etrade_oauth import ETradeOAuthClient
from stocvest.brokers.exceptions import BrokerAuthError, BrokerUnavailableError
from stocvest.utils.config import get_settings


def _query_params(event: LambdaEvent) -> dict[str, str]:
    query = event.get("queryStringParameters") or {}
    if not isinstance(query, dict):
        return {}
    out: dict[str, str] = {}
    for k, v in query.items():
        if v is None:
            continue
        out[str(k)] = str(v)
    return out


def etrade_oauth_start_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    request_context = build_request_context(event)
    if not request_context.user_id:
        return unauthorized("Authenticated user is required.")
    settings = get_settings()
    if not settings.etrade_consumer_key or not settings.etrade_consumer_secret:
        return bad_request("E*TRADE OAuth is not configured on the server.")
    query = _query_params(event)
    callback_url = str(query.get("callback_url") or "oob").strip()
    sandbox = str(query.get("sandbox") or "true").lower() in {"1", "true", "yes"}

    try:
        client = ETradeOAuthClient(
            consumer_key=settings.etrade_consumer_key,
            consumer_secret=settings.etrade_consumer_secret,
            sandbox=sandbox,
        )
        try:
            temp = client.request_token(callback_url=callback_url)
            url = client.build_authorize_url(temp.token)
        finally:
            client.close()
    except BrokerAuthError as exc:
        return unauthorized(str(exc))
    except BrokerUnavailableError as exc:
        return internal_error(str(exc))

    return ok(
        {
            "authorize_url": url,
            "oauth_token": temp.token,
            "oauth_token_secret": temp.token_secret,
        }
    )


def etrade_oauth_callback_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    request_context = build_request_context(event)
    if not request_context.user_id:
        return unauthorized("Authenticated user is required.")
    settings = get_settings()
    if not settings.etrade_consumer_key or not settings.etrade_consumer_secret:
        return bad_request("E*TRADE OAuth is not configured on the server.")
    try:
        body = parse_json_body(event)
        verifier = str(body.get("oauth_verifier") or body.get("verifier") or "").strip()
        request_token = str(body.get("oauth_token") or "").strip()
        request_token_secret = str(body.get("oauth_token_secret") or "").strip()
        sandbox = bool(body.get("sandbox", True))
        if not verifier or not request_token or not request_token_secret:
            return bad_request("oauth_verifier, oauth_token, and oauth_token_secret are required.")
    except ValueError as exc:
        return bad_request(str(exc))

    try:
        client = ETradeOAuthClient(
            consumer_key=settings.etrade_consumer_key,
            consumer_secret=settings.etrade_consumer_secret,
            sandbox=sandbox,
        )
        try:
            access = client.exchange_access_token(
                request_token=request_token,
                request_token_secret=request_token_secret,
                verifier=verifier,
            )
        finally:
            client.close()
    except BrokerAuthError as exc:
        return unauthorized(str(exc))
    except BrokerUnavailableError as exc:
        return internal_error(str(exc))

    return ok(
        {
            "access_token": access.token,
            "access_token_secret": access.token_secret,
            "message": "E*TRADE tokens issued — persist via broker connection flow before trading.",
        }
    )
