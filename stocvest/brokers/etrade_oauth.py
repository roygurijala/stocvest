"""E*TRADE OAuth helper (token lifecycle).

This module manages OAuth token workflow and is intentionally transport-only:
- it does not persist secrets/tokens
- it does not log sensitive values
- callers provide consumer credentials from secure storage
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import parse_qs, quote, urlencode, urlparse, urlunparse

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
                method="POST",
                path="/oauth/request_token",
                token=None,
                token_secret=None,
                oauth_params={"oauth_callback": callback_url},
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
                method="POST",
                path="/oauth/access_token",
                token=request_token,
                token_secret=request_token_secret,
                oauth_params={"oauth_verifier": verifier},
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
                method="POST",
                path="/oauth/renew_access_token",
                token=access_token,
                token_secret=access_token_secret,
                oauth_params={},
            )
        }
        self._request("POST", "/oauth/renew_access_token", headers=headers)

    def revoke_access_token(self, *, access_token: str, access_token_secret: str) -> None:
        headers = {
            "Authorization": self._auth_header(
                method="POST",
                path="/oauth/revoke_access_token",
                token=access_token,
                token_secret=access_token_secret,
                oauth_params={},
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
        method: str,
        path: str,
        token: str | None,
        token_secret: str | None,
        oauth_params: dict[str, str],
        request_params: dict[str, Any] | None = None,
        nonce: str | None = None,
        timestamp: str | None = None,
    ) -> str:
        oauth_values: dict[str, str] = {
            "oauth_consumer_key": self._consumer_key,
            "oauth_signature_method": "HMAC-SHA1",
            "oauth_timestamp": timestamp or str(int(time.time())),
            "oauth_nonce": nonce or self._generate_nonce(),
            "oauth_version": "1.0",
        }
        if token:
            oauth_values["oauth_token"] = token
        oauth_values.update(oauth_params)

        signature = self._oauth_hmac_sha1_signature(
            method=method,
            url=f"{self._base_url}{path}",
            oauth_params=oauth_values,
            request_params=request_params or {},
            token_secret=token_secret,
        )
        oauth_values["oauth_signature"] = signature

        parts = [
            f'{self._percent_encode(k)}="{self._percent_encode(v)}"'
            for k, v in sorted(oauth_values.items())
        ]
        return "OAuth " + ", ".join(parts)

    def _oauth_hmac_sha1_signature(
        self,
        *,
        method: str,
        url: str,
        oauth_params: dict[str, str],
        request_params: dict[str, Any],
        token_secret: str | None,
    ) -> str:
        normalized = self._normalize_params(oauth_params, request_params)
        base_string = "&".join(
            [
                method.upper(),
                self._percent_encode(self._normalize_url(url)),
                self._percent_encode(normalized),
            ]
        )
        signing_key = "&".join(
            [
                self._percent_encode(self._consumer_secret),
                self._percent_encode(token_secret or ""),
            ]
        )
        digest = hmac.new(
            signing_key.encode("utf-8"),
            base_string.encode("utf-8"),
            hashlib.sha1,
        ).digest()
        return base64.b64encode(digest).decode("ascii")

    @staticmethod
    def _normalize_params(
        oauth_params: dict[str, str],
        request_params: dict[str, Any],
    ) -> str:
        items: list[tuple[str, str]] = []
        for key, value in oauth_params.items():
            if key == "oauth_signature":
                continue
            items.append((str(key), str(value)))
        for key, value in request_params.items():
            if isinstance(value, (list, tuple)):
                for sub_value in value:
                    items.append((str(key), str(sub_value)))
            else:
                items.append((str(key), str(value)))

        items.sort(key=lambda kv: (ETradeOAuthClient._percent_encode(kv[0]), ETradeOAuthClient._percent_encode(kv[1])))
        return "&".join(
            f"{ETradeOAuthClient._percent_encode(k)}={ETradeOAuthClient._percent_encode(v)}"
            for k, v in items
        )

    @staticmethod
    def _normalize_url(url: str) -> str:
        parsed = urlparse(url)
        scheme = parsed.scheme.lower()
        host = (parsed.hostname or "").lower()
        port = parsed.port
        include_port = (
            port is not None
            and not (scheme == "http" and port == 80)
            and not (scheme == "https" and port == 443)
        )
        authority = f"{host}:{port}" if include_port else host
        path = parsed.path or "/"
        return f"{scheme}://{authority}{path}"

    @staticmethod
    def _percent_encode(value: str) -> str:
        return quote(value, safe="~-._")

    @staticmethod
    def _generate_nonce() -> str:
        return secrets.token_urlsafe(18)

