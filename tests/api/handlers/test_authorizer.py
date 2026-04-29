from __future__ import annotations

from stocvest.api.auth import AuthError
from stocvest.api.handlers.authorizer import handler


class _AllowVerifier:
    def verify(self, token: str) -> dict[str, str]:
        assert token == "good-token"
        return {"sub": "user-123", "scope": "read:portfolio"}


class _DenyVerifier:
    def verify(self, token: str) -> dict[str, str]:
        _ = token
        raise AuthError("invalid")


def test_authorizer_allows_valid_token() -> None:
    event = {
        "methodArn": "arn:aws:execute-api:us-east-1:123:api/dev/GET/v1/health",
        "headers": {"Authorization": "Bearer good-token"},
    }
    result = handler(event, context={}, verifier=_AllowVerifier())
    statement = result["policyDocument"]["Statement"][0]
    assert result["principalId"] == "user-123"
    assert statement["Effect"] == "Allow"
    assert result["context"]["scope"] == "read:portfolio"


def test_authorizer_denies_missing_header() -> None:
    event = {"methodArn": "arn:aws:execute-api:us-east-1:123:api/dev/GET/v1/health", "headers": {}}
    result = handler(event, context={}, verifier=_AllowVerifier())
    statement = result["policyDocument"]["Statement"][0]
    assert result["principalId"] == "anonymous"
    assert statement["Effect"] == "Deny"
    assert result["context"]["reason"] == "missing_bearer_token"


def test_authorizer_denies_invalid_token() -> None:
    event = {
        "methodArn": "arn:aws:execute-api:us-east-1:123:api/dev/GET/v1/health",
        "headers": {"Authorization": "Bearer bad-token"},
    }
    result = handler(event, context={}, verifier=_DenyVerifier())
    statement = result["policyDocument"]["Statement"][0]
    assert result["principalId"] == "anonymous"
    assert statement["Effect"] == "Deny"
    assert result["context"]["reason"] == "invalid_token"

