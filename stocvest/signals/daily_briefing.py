"""
Phase 2.5h: Daily briefing generator.

Assembles a single markdown document from already-computed scanner and signal
artifacts (no network I/O). Callers fetch data elsewhere, then pass structured
inputs here for user-facing copy.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from stocvest.signals.composite_score import CompositeSignal
from stocvest.signals.day_trading_scanner import PremarketGapCandidate
from stocvest.signals.news_catalyst_detector import NewsCatalystCandidate
from stocvest.signals.pdt_tracker import PDTAssessment


@dataclass(frozen=True)
class DailyBriefingInput:
    """Everything needed to render one briefing for a session date."""

    briefing_date: date
    gap_candidates: tuple[PremarketGapCandidate, ...] = ()
    news_catalysts: tuple[NewsCatalystCandidate, ...] = ()
    pdt_assessment: PDTAssessment | None = None
    swing_composite: CompositeSignal | None = None
    macro_headlines: tuple[str, ...] = ()
    geopolitical_line: str | None = None
    market_session_summary: str | None = None


@dataclass(frozen=True)
class DailyBriefing:
    """Rendered briefing (markdown suitable for email or dashboard)."""

    date_iso: str
    title: str
    markdown: str


class DailyBriefingGenerator:
    def __init__(self, *, max_gaps: int = 5, max_catalysts: int = 5) -> None:
        self._max_gaps = max(0, max_gaps)
        self._max_catalysts = max(0, max_catalysts)

    def generate(self, inp: DailyBriefingInput) -> DailyBriefing:
        lines: list[str] = []
        date_iso = inp.briefing_date.isoformat()
        title = f"STOCVEST daily briefing — {date_iso}"
        lines.append(f"# {title}")
        lines.append("")

        if inp.market_session_summary:
            lines.append("## Market session")
            lines.append(inp.market_session_summary.strip())
            lines.append("")

        if inp.macro_headlines:
            lines.append("## Macro")
            for h in inp.macro_headlines:
                lines.append(f"- {h.strip()}")
            lines.append("")

        if inp.geopolitical_line:
            lines.append("## Geopolitical")
            lines.append(inp.geopolitical_line.strip())
            lines.append("")

        if inp.swing_composite is not None:
            sc = inp.swing_composite
            lines.append("## Swing composite")
            lines.append(
                f"- Verdict: **{sc.verdict.value}** (score {sc.score:.2f}, "
                f"confidence {sc.confidence:.2f})"
            )
            lines.append("")

        lines.append("## Pre-market gaps")
        if not inp.gap_candidates:
            lines.append("- No gap candidates above current scan thresholds.")
        else:
            for c in inp.gap_candidates[: self._max_gaps]:
                lines.append(
                    f"- **{c.symbol}** {c.direction} gap {c.gap_percent:+.2f}% "
                    f"(rank {c.rank_score:.2f}, volume {c.day_volume:,.0f})"
                )
        lines.append("")

        lines.append("## News catalysts")
        if not inp.news_catalysts:
            lines.append("- No ranked catalysts for this window.")
        else:
            for c in inp.news_catalysts[: self._max_catalysts]:
                lines.append(
                    f"- **{c.symbol}** [{c.catalyst_type}] {c.direction} "
                    f"(score {c.catalyst_score:.2f}) — {c.title}"
                )
        lines.append("")

        lines.append("## PDT (pattern day trade) posture")
        if inp.pdt_assessment is None:
            lines.append("- No PDT assessment supplied.")
        else:
            p = inp.pdt_assessment
            if p.pdt_exempt:
                lines.append("- Account marked **PDT-exempt** (verified ≥ $25k).")
            else:
                lines.append(
                    f"- Day trades in rolling window: **{p.day_trades_in_window}** "
                    f"(max {p.max_non_exempt} / {p.rolling_business_days} weekdays)."
                )
                if p.warn_near_limit:
                    lines.append("- **Warning:** one day-trade slot left in the window.")
                if p.at_limit:
                    lines.append(
                        "- **Blocked:** at the non-exempt limit; no further day trades "
                        "until the window rolls."
                    )
                if not p.at_limit and not p.warn_near_limit:
                    lines.append("- Within limit; additional day trades allowed.")
        lines.append("")

        lines.append("---")
        lines.append("*Automated briefing — not investment advice.*")

        md = "\n".join(lines).strip() + "\n"
        return DailyBriefing(date_iso=date_iso, title=title, markdown=md)
