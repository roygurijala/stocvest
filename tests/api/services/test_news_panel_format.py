from __future__ import annotations

from datetime import datetime, timedelta, timezone

from stocvest.api.services.news_panel_format import compute_news_age_label


def test_news_endpoint_age_labels() -> None:
    now = datetime(2026, 5, 6, 18, 0, tzinfo=timezone.utc)
    assert compute_news_age_label(now, now - timedelta(minutes=30)) == "30m ago"
    assert compute_news_age_label(now, now - timedelta(hours=5)) == "5h ago"
    assert compute_news_age_label(now, datetime(2026, 5, 5, 15, 0, tzinfo=timezone.utc)) == "Yesterday"
    # Same NY week, before today: Wednesday now → Monday that week shows short weekday.
    assert compute_news_age_label(now, datetime(2026, 5, 4, 15, 0, tzinfo=timezone.utc)) == "Mon"
    # Older than current week in NY → "May 03" style (no zero pad on day in our formatter)
    assert compute_news_age_label(now, datetime(2026, 4, 28, 15, 0, tzinfo=timezone.utc)) == "Apr 28"
