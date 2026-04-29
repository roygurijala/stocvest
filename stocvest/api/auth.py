"""Cognito JWT verification helpers for API authorizer handlers."""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from typing import Any
from urllib.request import urlopen

import jwt

from stocvest.utils.config import get_settings


class AuthError(Exception):
    """Raised when auth token is missing, malformed, or invalid."""


@dataclass(frozen=True)
class CognitoAuthConfig:
    region: str
    user_pool_id: str
    app_client_id: str

    @property
    def issuer(self) -> str:
        return f"https://cognito-idp.{self.region}.amazonaws.com/{self.user_pool_id}"

    @property
    def jwks_url(self) -> str:
        return f"{self.issuer}/.well-known/jwks.json"


def get_cognito_auth_config() -> CognitoAuthConfig:
    settings = get_settings()
    region = settings.cognito_region or settings.aws_region
    user_pool_id = settings.cognito_user_pool_id.strip()
    app_client_id = settings.cognito_app_client_id.strip()
    if not user_pool_id or not app_client_id:
        raise AuthError("Cognito authorizer is not configured.")
    return CognitoAuthConfig(
        region=region.strip(),
        user_pool_id=user_pool_id,
        app_client_id=app_client_id,
    )


@lru_cache(maxsize=8)
def _cached_jwks(jwks_url: str) -> dict[str, Any]:
    with urlopen(jwks_url, timeout=5) as response:  # noqa: S310 - trusted AWS URL from config
        payload = response.read().decode("utf-8")
    parsed = json.loads(payload)
    if not isinstance(parsed, dict):
        raise AuthError("Invalid JWKS payload.")
    return parsed


class CognitoJwtVerifier:
    """Validates Cognito ID/access JWTs using issuer audience and JWKS signature."""

    def __init__(self, config: CognitoAuthConfig | None = None) -> None:
        self._config = config or get_cognito_auth_config()

    def verify(self, token: str) -> dict[str, Any]:
        if not token:
            raise AuthError("Missing bearer token.")

        try:
            unverified_header = jwt.get_unverified_header(token)
        except jwt.PyJWTError as exc:
            raise AuthError("Invalid JWT header.") from exc

        kid = str(unverified_header.get("kid") or "").strip()
        if not kid:
            raise AuthError("JWT missing key id (kid).")

        jwks = _cached_jwks(self._config.jwks_url)
        key = _resolve_public_key(jwks, kid)
        if key is None:
            raise AuthError("JWT signing key not found.")

        try:
            claims = jwt.decode(
                token,
                key=key,
                algorithms=["RS256"],
                audience=self._config.app_client_id,
                issuer=self._config.issuer,
                options={"require": ["exp", "iat", "sub"]},
            )
        except jwt.PyJWTError as exc:
            raise AuthError("JWT validation failed.") from exc

        if not isinstance(claims, dict):
            raise AuthError("JWT claims payload must be an object.")
        return claims


def _resolve_public_key(jwks: dict[str, Any], kid: str) -> Any | None:
    keys = jwks.get("keys")
    if not isinstance(keys, list):
        return None
    for item in keys:
        if isinstance(item, dict) and item.get("kid") == kid:
            try:
                return jwt.algorithms.RSAAlgorithm.from_jwk(json.dumps(item))
            except Exception:  # pragma: no cover - malformed JWK edge-case
                return None
    return None

