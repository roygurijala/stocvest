from __future__ import annotations

from unittest.mock import MagicMock, patch

import httpx
import pytest

from stocvest.services.postmark_client import send_postmark_html_email


def _mock_client(status_code: int, json_body: dict | None) -> MagicMock:
    mock_resp = MagicMock()
    mock_resp.status_code = status_code
    if json_body is None:
        mock_resp.json.side_effect = ValueError("no json")
    else:
        mock_resp.json.return_value = json_body
    mock_client = MagicMock()
    mock_client.post.return_value = mock_resp
    mock_client.__enter__ = MagicMock(return_value=mock_client)
    mock_client.__exit__ = MagicMock(return_value=False)
    return mock_client


def test_send_postmark_html_email_success() -> None:
    mock_client = _mock_client(200, {"ErrorCode": 0, "Message": "OK"})

    with patch("stocvest.services.postmark_client.httpx.Client", return_value=mock_client):
        ok = send_postmark_html_email(
            server_token="token",
            sender="signals@stocvest.ai",
            to_email="user@example.com",
            subject="Test",
            html_body="<p>hi</p>",
        )

    assert ok is True
    mock_client.post.assert_called_once()
    _args, kwargs = mock_client.post.call_args
    assert kwargs["json"]["From"] == "signals@stocvest.ai"
    assert kwargs["headers"]["X-Postmark-Server-Token"] == "token"


def test_send_postmark_html_email_nonzero_errorcode_returns_false() -> None:
    # HTTP 200 but a non-zero ErrorCode (e.g. inactive recipient / sending blocked) is a soft failure.
    mock_client = _mock_client(200, {"ErrorCode": 406, "Message": "Inactive recipient"})

    with patch("stocvest.services.postmark_client.httpx.Client", return_value=mock_client):
        ok = send_postmark_html_email(
            server_token="token",
            sender="signals@stocvest.ai",
            to_email="user@example.com",
            subject="Test",
            html_body="<p>hi</p>",
        )

    assert ok is False


def test_send_postmark_html_email_missing_token_returns_false() -> None:
    assert (
        send_postmark_html_email(
            server_token="",
            sender="signals@stocvest.ai",
            to_email="user@example.com",
            subject="Test",
            html_body="<p>hi</p>",
        )
        is False
    )


def test_send_postmark_html_email_http_error_returns_false() -> None:
    mock_client = MagicMock()
    mock_client.post.side_effect = httpx.ConnectError("network")
    mock_client.__enter__ = MagicMock(return_value=mock_client)
    mock_client.__exit__ = MagicMock(return_value=False)

    with patch("stocvest.services.postmark_client.httpx.Client", return_value=mock_client):
        ok = send_postmark_html_email(
            server_token="token",
            sender="signals@stocvest.ai",
            to_email="user@example.com",
            subject="Test",
            html_body="<p>hi</p>",
        )

    assert ok is False
