"""API layer package for AWS Lambda handlers and shared utilities."""

from stocvest.api.response import (
    bad_request,
    forbidden,
    internal_error,
    json_response,
    not_found,
    ok,
    unauthorized,
)
from stocvest.api.auth import AuthError, CognitoAuthConfig, CognitoJwtVerifier, get_cognito_auth_config
from stocvest.api.shared import RequestContext, build_request_context, get_bearer_token, parse_json_body

__all__ = [
    "AuthError",
    "CognitoAuthConfig",
    "CognitoJwtVerifier",
    "RequestContext",
    "bad_request",
    "build_request_context",
    "forbidden",
    "get_cognito_auth_config",
    "get_bearer_token",
    "internal_error",
    "json_response",
    "not_found",
    "ok",
    "parse_json_body",
    "unauthorized",
]

