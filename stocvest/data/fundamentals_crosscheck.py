"""SEC-XBRL ↔ data-provider (FMP) fundamentals cross-check — ADR-004 POS-AI-10 v2.

Pure, deterministic, network-free comparison of the SEC's primary-source XBRL figures
(``stocvest.data.sec_xbrl``) against the same-fiscal-year figures our scoring provider
(FMP ``IncomeStatement``) reports, for a **small, unambiguous** set of headline lines:
revenue, net income, diluted EPS.

This is a **data-quality flag, not a reconciliation**. It only compares values for the
*same fiscal year* (so an off-calendar year never causes a false mismatch), flags a
disagreement when the relative difference exceeds a display tolerance, and NEVER edits,
reconciles, or feeds either source into the pillar math. The tolerance is a presentation
sensitivity, not a scoring constant. Everything degrades to "not comparable" rather than
guessing when either side is missing or the fiscal years don't line up.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from stocvest.data.fundamentals_models import IncomeStatement
from stocvest.data.sec_xbrl import CompanyFacts, XbrlFact

# Relative difference (0..1) above which SEC and the provider are flagged as disagreeing.
# Display sensitivity only — small rounding/restatement gaps below this are treated as agreement.
DEFAULT_TOLERANCE = 0.05

# Minimum ABSOLUTE difference (per unit) below which a large relative gap is treated as
# immaterial. This stops near-zero lines (e.g. a break-even net income where SEC=+$2M and the
# provider=-$1M) from reading as a huge % "disagreement". Display sensitivity only.
_ABS_FLOOR: dict[str, float] = {"USD": 1e7, "USD/shares": 0.02}


def _abs_floor(unit: str) -> float:
    return _ABS_FLOOR.get(unit, 0.0)

# Concepts we can compare unambiguously. Maps the XBRL fact key -> FMP IncomeStatement attr.
_COMPARABLE: tuple[tuple[str, str, str], ...] = (
    ("revenue", "revenue", "Revenue"),
    ("net_income", "net_income", "Net income"),
    ("diluted_eps", "eps_diluted", "Diluted EPS"),
)


@dataclass(frozen=True)
class CrossCheckRow:
    key: str
    label: str
    unit: str
    fiscal_year: int | None
    sec_value: float | None
    provider_value: float | None
    rel_diff: float | None  # None when not comparable
    agrees: bool | None  # None when not comparable (missing side / no matching fiscal year)
    note: str = ""

    def to_api_dict(self) -> dict[str, Any]:
        return {
            "key": self.key,
            "label": self.label,
            "unit": self.unit,
            "fiscal_year": self.fiscal_year,
            "sec_value": self.sec_value,
            "provider_value": self.provider_value,
            "rel_diff": self.rel_diff,
            "agrees": self.agrees,
            "note": self.note,
        }


@dataclass(frozen=True)
class FundamentalsCrossCheck:
    symbol: str
    provider: str
    rows: list[CrossCheckRow] = field(default_factory=list)

    @property
    def disagreements(self) -> int:
        return sum(1 for r in self.rows if r.agrees is False)

    @property
    def comparable(self) -> int:
        return sum(1 for r in self.rows if r.agrees is not None)

    @property
    def has_data(self) -> bool:
        return bool(self.rows)

    def to_api_dict(self) -> dict[str, Any]:
        return {
            "symbol": self.symbol,
            "provider": self.provider,
            "rows": [r.to_api_dict() for r in self.rows],
            "disagreements": self.disagreements,
            "comparable": self.comparable,
            "scored": False,  # explicit: informational data-quality flag only
        }


def _rel_diff(a: float, b: float) -> float:
    denom = max(abs(a), abs(b))
    if denom == 0:
        return 0.0
    return abs(a - b) / denom


def _annuals_by_year(statements: list[IncomeStatement] | None) -> dict[int, IncomeStatement]:
    """Index annual income statements by fiscal (calendar) year; newest wins on duplicates."""
    out: dict[int, IncomeStatement] = {}
    for s in statements or []:
        if s is None:
            continue
        # Only true annual rows carry a period of "FY"; skip anything quarterly.
        if s.period is not None and str(s.period).strip().upper() not in ("FY", "ANNUAL", ""):
            continue
        year = s.calendar_year
        if year is None:
            continue
        prev = out.get(int(year))
        if prev is None or (s.as_of_date and prev.as_of_date and s.as_of_date > prev.as_of_date):
            out[int(year)] = s
    return out


def build_fundamentals_crosscheck(
    company_facts: CompanyFacts | None,
    income_statements: list[IncomeStatement] | None,
    *,
    provider: str = "FMP",
    tolerance: float = DEFAULT_TOLERANCE,
) -> FundamentalsCrossCheck | None:
    """Compare SEC XBRL facts vs same-fiscal-year provider figures. Pure; ``None`` if no SEC facts.

    A row is emitted for each comparable concept the SEC reports. ``agrees`` is:
      * ``True``  — provider value for the same fiscal year is within ``tolerance``;
      * ``False`` — provider value for the same fiscal year differs by more than ``tolerance``;
      * ``None``  — not comparable (provider missing the line or the fiscal year).
    """
    if company_facts is None or not company_facts.has_data:
        return None

    sec_by_key: dict[str, XbrlFact] = {f.key: f for f in company_facts.facts}
    by_year = _annuals_by_year(income_statements)

    rows: list[CrossCheckRow] = []
    for xbrl_key, fmp_attr, label in _COMPARABLE:
        fact = sec_by_key.get(xbrl_key)
        if fact is None:
            continue  # SEC didn't report this line — nothing to display
        fy = fact.fiscal_year
        stmt = by_year.get(int(fy)) if fy is not None else None
        provider_value = getattr(stmt, fmp_attr, None) if stmt is not None else None

        if fy is None:
            note = "SEC fiscal year unknown — not compared"
            rows.append(
                CrossCheckRow(xbrl_key, label, fact.unit, fy, fact.value, None, None, None, note)
            )
            continue
        if provider_value is None:
            note = (
                f"No {provider} FY{fy} value to compare"
                if stmt is None
                else f"{provider} FY{fy} missing this line"
            )
            rows.append(
                CrossCheckRow(xbrl_key, label, fact.unit, fy, fact.value, None, None, None, note)
            )
            continue

        rd = _rel_diff(float(fact.value), float(provider_value))
        abs_diff = abs(float(fact.value) - float(provider_value))
        if rd <= tolerance:
            agrees = True
            note = "within tolerance"
        elif abs_diff < _abs_floor(fact.unit):
            # Relative gap is large but the absolute gap is immaterial (near-zero line).
            agrees = True
            note = f"immaterial (Δ below {fact.unit} floor)"
        else:
            agrees = False
            note = f"differs {rd * 100:.1f}% (SEC vs {provider})"
        rows.append(
            CrossCheckRow(
                xbrl_key,
                label,
                fact.unit,
                fy,
                fact.value,
                float(provider_value),
                rd,
                agrees,
                note,
            )
        )

    if not rows:
        return None
    return FundamentalsCrossCheck(symbol=company_facts.symbol, provider=provider, rows=rows)
