"""Earnings calendar company name enrichment."""

from __future__ import annotations

from stocvest.data.earnings_calendar_fetch import enrich_earnings_company_names
from stocvest.data.models import EarningsEvent


def test_enrich_replaces_symbol_only_name(monkeypatch) -> None:
    monkeypatch.setattr(
        "stocvest.data.earnings_calendar_fetch.get_resolver",
        lambda: type(
            "R",
            (),
            {"get_name_variants": staticmethod(lambda s: ["Dell Technologies Inc"] if s == "DELL" else [s])},
        )(),
    )
    events = [
        EarningsEvent(
            symbol="DELL",
            company_name="DELL",
            report_date=__import__("datetime").date(2026, 6, 3),
            report_time="after_market",
        )
    ]
    out = enrich_earnings_company_names(events)
    assert out[0].company_name == "Dell Technologies Inc"
