"""API Gateway request authorizer for Cognito JWT tokens."""

from __future__ import annotations

from typing import Any

from stocvest.api.auth import AuthError, CognitoJwtVerifier
from stocvest.api.shared import get_bearer_token
from stocvest.api.types import LambdaContext, LambdaEvent


def _policy(principal_id: str, effect: str, resource: str, context: dict[str, str]) -> dict[str, Any]:
    return {
        "principalId": principal_id,
        "policyDocument": {
            "Version": "2012-10-17",
            "Statement": [
                {
                    "Action": "execute-api:Invoke",
                    "Effect": effect,
                    "Resource": resource,
                }
            ],
        },
        "context": context,
    }


def handler(
    event: LambdaEvent,
    context: LambdaContext,
    verifier: CognitoJwtVerifier | None = None,
) -> dict[str, Any]:
    _ = context
    method_arn = str(event.get("methodArn") or "*")
    token = get_bearer_token(event)
    if not token:
        return _policy("anonymous", "Deny", method_arn, {"reason": "missing_bearer_token"})

    jwt_verifier = verifier or CognitoJwtVerifier()
    try:
        claims = jwt_verifier.verify(token)
    except AuthError:
        return _policy("anonymous", "Deny", method_arn, {"reason": "invalid_token"})

    principal_id = str(claims.get("sub") or "user")
    scope = str(claims.get("scope") or "")
    return _policy(
        principal_id,
        "Allow",
        method_arn,
        {"sub": principal_id, "scope": scope},
    )

