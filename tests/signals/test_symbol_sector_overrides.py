from datetime import date

from stocvest.data.ticker_reference import TickerReference
from stocvest.signals.symbol_sector_overrides import resolve_symbol_sector_override


def _adr(symbol: str, *, country: str, name: str) -> TickerReference:
    return TickerReference(
        symbol=symbol,
        active=True,
        market_cap=1_000_000_000.0,
        security_type="ADRC",
        locale="us",
        country_code=country,
        primary_exchange="XNYS",
        list_date=date(2010, 1, 1),
        name=name,
    )


def test_ggal_explicit_override() -> None:
    assert resolve_symbol_sector_override("GGAL") == ("banks", "Argentine Banks")


def test_adr_country_financial_name_heuristic() -> None:
    ref = _adr("FOO", country="AR", name="Banco Example SA")
    assert resolve_symbol_sector_override("FOO", ref) == ("banks", "Argentina Financials")


def test_non_financial_adr_without_explicit_override_returns_none() -> None:
    ref = _adr("CEPU", country="AR", name="Central Puerto")
    assert resolve_symbol_sector_override("ZZZ", ref) is None
