"""Local HTTP API for Next.js dev: mimics API Gateway v2 events and calls ``lambda_dispatch``."""

from __future__ import annotations

import json
import os
import sys
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse

from dotenv import load_dotenv

# Repo root (parent of scripts/) — editable install is optional for local dev
_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))
load_dotenv(_ROOT / ".env")

from stocvest.api.lambda_dispatch import lambda_handler  # noqa: E402

_ENV_LOCK = threading.Lock()
_DEFAULT_DEV_SUB = "local-dev-user"


def _module_for_path(method: str, path_only: str) -> str | None:
    p = path_only.split("?")[0]
    if not p.startswith("/"):
        p = "/" + p
    m = method.upper()
    if p == "/v1/health" and m == "GET":
        return "health"
    if p.startswith("/v1/market"):
        return "market_data"
    if p.startswith("/v1/signals"):
        return "signals"
    if p.startswith("/v1/brokers"):
        return "brokers"
    if p.startswith("/v1/users"):
        return "brokers"
    if p.startswith("/v1/orders"):
        return "brokers"
    if p.startswith("/v1/profile"):
        return "brokers"
    if p.startswith("/v1/watchlists"):
        return "brokers"
    if p.startswith("/v1/alerts"):
        return "brokers"
    if p.startswith("/v1/portfolio"):
        return "portfolio"
    if p.startswith("/v1/journal"):
        return "journal"
    if p.startswith("/v1/trade-plans"):
        return "trade_plans"
    if p.startswith("/v1/pdt"):
        return "pdt"
    if p.startswith("/v1/scanner"):
        return "scanner"
    return None


def _query_string_parameters(raw_query: str) -> dict[str, str] | None:
    if not raw_query:
        return None
    raw = parse_qs(raw_query, keep_blank_values=True)
    out: dict[str, str] = {}
    for k, vs in raw.items():
        if vs:
            out[k] = vs[-1]
    return out or None


def _headers_from_handler(handler: BaseHTTPRequestHandler) -> dict[str, str]:
    out: dict[str, str] = {}
    for k, v in handler.headers.items():
        out[k.lower()] = v
    return out


def _build_event(
    *,
    method: str,
    path_only: str,
    raw_query: str,
    headers: dict[str, str],
    body: str | None,
    dev_sub: str,
    dev_email: str,
) -> dict[str, Any]:
    route_key = f"{method.upper()} {path_only}"
    qs = _query_string_parameters(raw_query)
    return {
        "version": "2.0",
        "routeKey": route_key,
        "rawPath": path_only,
        "rawQueryString": raw_query,
        "path": path_only,
        "httpMethod": method.upper(),
        "headers": headers,
        "queryStringParameters": qs,
        "body": body,
        "isBase64Encoded": False,
        "requestContext": {
            "requestId": f"local-{uuid.uuid4()}",
            "authorizer": {
                "claims": {
                    "sub": dev_sub,
                    "email": dev_email,
                    "scope": "openid email profile",
                }
            },
            "http": {"method": method.upper(), "path": path_only},
        },
    }


def _send_lambda_response(handler: BaseHTTPRequestHandler, resp: dict[str, Any]) -> None:
    status = int(resp.get("statusCode") or 500)
    hdrs = resp.get("headers") or {}
    body = resp.get("body")
    if body is None:
        body_str = ""
    elif isinstance(body, (dict, list)):
        body_str = json.dumps(body)
    else:
        body_str = str(body)

    handler.send_response(status)
    for hk, hv in hdrs.items():
        if isinstance(hv, str):
            handler.send_header(hk, hv)
    handler.send_header("Content-Length", str(len(body_str.encode("utf-8"))))
    handler.end_headers()
    if body_str:
        handler.wfile.write(body_str.encode("utf-8"))


class _Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, format: str, *args: Any) -> None:
        # Quieter than default stderr Apache-style log
        print(f"[dev_local_api] {self.address_string()} - {format % args}")

    def _cors_preflight(self) -> None:
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "authorization, content-type")
        self.send_header("Access-Control-Max-Age", "86400")
        self.end_headers()

    def do_OPTIONS(self) -> None:  # noqa: N802
        self._cors_preflight()

    def _dispatch(self, method: str) -> None:
        parsed = urlparse(self.path)
        path_only = unquote(parsed.path)
        raw_q = parsed.query or ""
        dev_sub = os.environ.get("STOCVEST_DEV_USER_SUB", _DEFAULT_DEV_SUB).strip() or _DEFAULT_DEV_SUB
        dev_email = os.environ.get("STOCVEST_DEV_USER_EMAIL", "dev@stocvest.local").strip() or "dev@stocvest.local"

        module = _module_for_path(method, path_only)
        if module is None:
            self.send_response(404)
            self.send_header("Content-Type", "application/json")
            msg = json.dumps({"error": "not_found", "message": f"No local route for {method} {path_only}"})
            self.send_header("Content-Length", str(len(msg.encode("utf-8"))))
            self.end_headers()
            self.wfile.write(msg.encode("utf-8"))
            return

        body: str | None = None
        if method.upper() in ("POST", "PUT", "PATCH", "DELETE"):
            length = self.headers.get("Content-Length")
            if length and length.isdigit():
                raw = self.rfile.read(int(length))
                body = raw.decode("utf-8")

        event = _build_event(
            method=method,
            path_only=path_only,
            raw_query=raw_q,
            headers=_headers_from_handler(self),
            body=body,
            dev_sub=dev_sub,
            dev_email=dev_email,
        )

        with _ENV_LOCK:
            prev = os.environ.get("STOCVEST_LAMBDA_MODULE")
            os.environ["STOCVEST_LAMBDA_MODULE"] = module
            try:
                resp = lambda_handler(event, {})
            finally:
                if prev is None:
                    os.environ.pop("STOCVEST_LAMBDA_MODULE", None)
                else:
                    os.environ["STOCVEST_LAMBDA_MODULE"] = prev

        _send_lambda_response(self, resp)

    def do_GET(self) -> None:  # noqa: N802
        self._dispatch("GET")

    def do_POST(self) -> None:  # noqa: N802
        self._dispatch("POST")

    def do_DELETE(self) -> None:  # noqa: N802
        self._dispatch("DELETE")

    def do_PATCH(self) -> None:  # noqa: N802
        self._dispatch("PATCH")


def main() -> None:
    host = os.environ.get("STOCVEST_DEV_API_HOST", "127.0.0.1")
    port = int(os.environ.get("STOCVEST_DEV_API_PORT", "3001"))
    httpd = ThreadingHTTPServer((host, port), _Handler)
    print(f"[dev_local_api] listening on http://{host}:{port} (load_dotenv from {_ROOT / '.env'})")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
