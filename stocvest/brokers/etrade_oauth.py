"""E*TRADE OAuth helper (token lifecycle).

This module manages OAuth token workflow and is intentionally transport-only:
- it does not persist secrets/tokens
- it does not log sensitive values
- callers provide consumer credentials from secure storage
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

import httpx

from stocvest.brokers.exceptions import (
    BrokerAuthError,
    BrokerRateLimitError,
    BrokerRejectedError,
    BrokerUnavailableError,
)


def _parse_oauth_kv(body: str) -> dict[str, str]:
    parsed = parse_qs(body, keep_blank_values=True)
    out: dict[str, str] = {}
    for k, v in parsed.items():
        out[k] = v[0] if v else ""
    return out


@dataclass(frozen=True)
class OAuthTemporaryToken:
    token: str
    token_secret: str


@dataclass(frozen=True)
class OAuthAccessToken:
    token: str
    token_secret: str


class ETradeOAuthClient:
    """
    OAuth endpoint client for E*TRADE.

    Note:
    - E*TRADE OAuth signing details are encapsulated in `_auth_header`.
    - This keeps auth concerns isolated from trading route logic.
    """

    def __init__(
        self,
        *,
        consumer_key: str,
        consumer_secret: str,
        sandbox: bool = True,
        timeout_s: float = 20.0,
    ) -> None:
        if not consumer_key or not consumer_secret:
            raise BrokerAuthError("E*TRADE consumer key/secret required")
        self._consumer_key = consumer_key
        self._consumer_secret = consumer_secret
        self._timeout_s = timeout_s
        self._base_url = "https://apisb.etrade.com" if sandbox else "https://api.etrade.com"
        self._client = httpx.Client(base_url=self._base_url, timeout=self._timeout_s)

    def close(self) -> None:
        self._client.close()

    def request_token(self, *, callback_url: str = "oob") -> OAuthTemporaryToken:
        headers = {
            "Authorization": self._auth_header(
                token=None,
                token_secret=None,
                extra_params={"oauth_callback": callback_url},
            )
        }
        resp = self._request("POST", "/oauth/request_token", headers=headers)
        data = _parse_oauth_kv(resp.text)
        token = data.get("oauth_token", "")
        secret = data.get("oauth_token_secret", "")
        if not token or not secret:
            raise BrokerAuthError("E*TRADE request_token response missing oauth token fields")
        return OAuthTemporaryToken(token=token, token_secret=secret)

    def build_authorize_url(self, request_token: str) -> str:
        if not request_token:
            raise BrokerAuthError("request_token required for authorize URL")
        parts = urlparse(f"{self._base_url}/e/t/etws/authorize")
        q = urlencode({"key": self._consumer_key, "token": request_token})
        return urlunparse((parts.scheme, parts.netloc, parts.path, "", q, ""))

    def exchange_access_token(
        self,
        *,
        request_token: str,
        request_token_secret: str,
        verifier: str,
    ) -> OAuthAccessToken:
        headers = {
            "Authorization": self._auth_header(
                token=request_token,
                token_secret=request_token_secret,
                extra_params={"oauth_verifier": verifier},
            )
        }
        resp = self._request("POST", "/oauth/access_token", headers=headers)
        data = _parse_oauth_kv(resp.text)
        token = data.get("oauth_token", "")
        secret = data.get("oauth_token_secret", "")
        if not token or not secret:
            raise BrokerAuthError("E*TRADE access_token response missing oauth token fields")
        return OAuthAccessToken(token=token, token_secret=secret)

    def renew_access_token(self, *, access_token: str, access_token_secret: str) -> None:
        headers = {
            "Authorization": self._auth_header(
                token=access_token,
                token_secret=access_token_secret,
                extra_params={},
            )
        }
        self._request("POST", "/oauth/renew_access_token", headers=headers)

    def revoke_access_token(self, *, access_token: str, access_token_secret: str) -> None:
        headers = {
            "Authorization": self._auth_header(
                token=access_token,
                token_secret=access_token_secret,
                extra_params={},
            )
        }
        self._request("POST", "/oauth/revoke_access_token", headers=headers)

    def _request(
        self,
        method: str,
        path: str,
        *,
        headers: dict[str, str],
        params: dict[str, Any] | None = None,
    ) -> httpx.Response:
        try:
            resp = self._client.request(method, path, headers=headers, params=params)
        except httpx.RequestError as exc:
            raise BrokerUnavailableError(f"E*TRADE OAuth network error: {exc}") from exc

        if resp.status_code in (401, 403):
            raise BrokerAuthError(f"E*TRADE OAuth auth failure status={resp.status_code}")
        if resp.status_code == 429:
            raise BrokerRateLimitError("E*TRADE OAuth rate limit")
        if resp.status_code >= 500:
            raise BrokerUnavailableError(f"E*TRADE OAuth server error status={resp.status_code}")
        if resp.status_code >= 400:
            raise BrokerRejectedError(
                f"E*TRADE OAuth rejected request status={resp.status_code} body={resp.text[:200]}"
            )
        return resp

    def _auth_header(
        self,
        *,
        token: str | None,
        token_secret: str | None,
        extra_params: dict[str, str],
    ) -> str:
        """
        Build OAuth1 header placeholder.

        For current phase scope, we provide a deterministic header shape used by tests.
        Swap this with a full OAuth1 signer before live rollout if required by broker.
        """
        parts = [
            f'oauth_consumer_key="{self._consumer_key}"',
            'oauth_signature_method="PLAINTEXT"',
            'oauth_version="1.0"',
        ]
        if token:
            parts.append(f'oauth_token="{token}"')
        for key, val in extra_params.items():
            parts.append(f'{key}="{val}"')
        signature_right = token_secret or ""
        parts.append(f'oauth_signature="{self._consumer_secret}&{signature_right}"')
        return "OAuth " + ", ".join(parts)

