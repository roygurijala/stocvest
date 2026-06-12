from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from stocvest.data.models import AlertType
from stocvest.services.email_service import EmailService
from stocvest.utils.config import get_settings


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


def test_subject_watchlist_maturation() -> None:
    es = EmailService()
    s = es._build_subject(
        AlertType.WATCHLIST_MATURATION,
        {
            "symbol": "AAPL",
            "mode": "swing",
            "previous_state": "actionable",
            "new_state": "developing",
            "previous_label": "Actionable",
            "new_label": "Developing",
        },
    )
    assert "AAPL" in s and "swing" in s.lower() and "Actionable" in s and "Developing" in s


def test_html_maturation_links_watchlists() -> None:
    es = EmailService()
    html_out = es._build_html_body(
        AlertType.WATCHLIST_MATURATION,
        {"symbol": "X", "mode": "day", "previous_label": "A", "new_label": "B"},
    )
    assert "dashboard/watchlists" in html_out
    assert "View watchlists" in html_out


def test_html_contains_disclaimer() -> None:
    es = EmailService()
    html_out = es._build_html_body(
        AlertType.SIGNAL_FIRED,
        {"symbol": "X", "direction": "Long", "strength": 72, "pattern": "VWAP Reclaim"},
    )
    assert "informational purposes" in html_out.lower()


def test_html_signal_uses_light_theme_and_readable_text() -> None:
    es = EmailService()
    html_out = es._build_html_body(
        AlertType.SIGNAL_FIRED,
        {
            "symbol": "BRK.B",
            "direction": "Long",
            "strength": 72,
            "pattern": "VWAP Reclaim · EMA9 Bounce",
        },
    )
    assert "background:#f4f7fa" in html_out or "background:#ffffff" in html_out
    assert "color:#0f1c2e" in html_out
    assert "Setup" in html_out
    assert "VWAP Reclaim" in html_out
    assert "n_confirming" not in html_out


def test_html_contains_unsubscribe_link() -> None:
    es = EmailService()
    html = es._build_html_body(AlertType.SIGNAL_FIRED, {"symbol": "X", "direction": "long", "strength": 50})
    assert "Manage alert preferences" in html
    assert "dashboard/settings" in html


def test_send_failure_returns_false_not_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("POSTMARK_SERVER_TOKEN", "pm-test-token")
    monkeypatch.setenv("STOCVEST_EMAIL_SENDER", "signals@stocvest.ai")
    get_settings.cache_clear()

    with patch("stocvest.services.email_service.send_postmark_html_email", return_value=False):
        es = EmailService()
        assert (
            es.send_alert_email(
                to_email="u@example.com",
                alert_type=AlertType.SIGNAL_FIRED,
                context={"symbol": "SPY", "direction": "long", "strength": 1},
            )
            is False
        )


def test_send_skips_without_postmark_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("POSTMARK_SERVER_TOKEN", raising=False)
    monkeypatch.setenv("STOCVEST_EMAIL_SENDER", "signals@stocvest.ai")
    get_settings.cache_clear()

    with patch("stocvest.services.email_service.send_postmark_html_email") as mock_send:
        es = EmailService()
        assert (
            es.send_alert_email(
                to_email="u@example.com",
                alert_type=AlertType.SIGNAL_FIRED,
                context={"symbol": "SPY", "direction": "long", "strength": 1},
            )
            is False
        )
        mock_send.assert_not_called()


def test_html_execution_actionable_shows_strength_setup_and_zone() -> None:
    es = EmailService()
    html_out = es._build_html_body(
        AlertType.EXECUTION_ACTIONABLE,
        {
            "symbol": "GGAL",
            "mode": "swing",
            "direction": "long",
            "strength": 68,
            "pattern": "ema9_bounce volume_expansion",
            "entry_zone_low": 42.10,
            "entry_zone_high": 43.50,
            "price": 42.85,
            "risk_reward": 2.4,
            "min_rr": 2.0,
            "alignment_ratio": 0.67,
        },
    )
    assert "68%" in html_out
    assert "EMA9 Bounce" in html_out
    assert "Volume Expansion" in html_out
    assert "$42.10" in html_out
    assert "$43.50" in html_out
    assert "Risk / reward" in html_out
    assert "Layer alignment" in html_out
