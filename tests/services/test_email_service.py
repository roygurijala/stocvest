from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from stocvest.data.models import AlertType
from stocvest.services.email_service import EmailService


def test_subject_line_signal_fired() -> None:
    es = EmailService()
    s = es._build_subject(
        AlertType.SIGNAL_FIRED,
        {"symbol": "AAPL", "direction": "long", "strength": 72},
    )
    assert "AAPL" in s and "long" in s and "72%" in s


def test_subject_line_confluence() -> None:
    es = EmailService()
    s = es._build_subject(AlertType.CONFLUENCE_ALERT, {"symbol": "TSLA", "n_confirming": 3})
    assert "CONFLUENCE" in s and "3" in s


def test_subject_line_pdt_warning() -> None:
    es = EmailService()
    s = es._build_subject(AlertType.PDT_WARNING, {"trades_used": 2})
    assert "2" in s and "PDT Warning" in s


def test_html_contains_disclaimer() -> None:
    es = EmailService()
    html = es._build_html_body(AlertType.SIGNAL_FIRED, {"symbol": "X", "direction": "long", "strength": 50})
    assert "informational purposes" in html.lower()


def test_html_contains_unsubscribe_link() -> None:
    es = EmailService()
    html = es._build_html_body(AlertType.SIGNAL_FIRED, {"symbol": "X", "direction": "long", "strength": 50})
    assert "Manage alert preferences" in html
    assert "dashboard/settings" in html


def test_send_failure_returns_false_not_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    mock_client = MagicMock()
    mock_client.send_email.side_effect = OSError("network")
    monkeypatch.setattr("boto3.client", lambda *a, **k: mock_client)
    es = EmailService()
    assert (
        es.send_alert_email(
            to_email="u@example.com",
            alert_type=AlertType.SIGNAL_FIRED,
            context={"symbol": "SPY", "direction": "long", "strength": 1},
        )
        is False
    )
