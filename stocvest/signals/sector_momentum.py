"""Persistence-based sector momentum scoring (day vs swing)."""

from __future__ import annotations

from dataclasses import dataclass

from stocvest.workers.sector_daily_cache import DailyReturn, get_all_cached_sector_data, get_cached_sector_returns


@dataclass
class SectorMomentumScore:
    etf: str
    sector_key: str
    display_name: str
    rel_1d: float
    rel_5d: float
    persistence: float
    acceleration: float
    sessions_leading: int
    total_sessions: int
    rank_1d: float
    rank_5d: float
    score: float
    trending: str
    verdict: str
    interpretation_chip: str
    data_available: bool


ETF_DISPLAY_NAMES = {
    "XLK": "Tech",
    "XLC": "Comm Services",
    "XLE": "Energy",
    "XLF": "Financials",
    "XLV": "Healthcare",
    "XLY": "Consumer Disc",
    "XLP": "Consumer Staples",
    "XLI": "Industrials",
    "XLRE": "Real Estate",
    "XLB": "Materials",
    "XLU": "Utilities",
    "SMH": "Semiconductors",
    "SOXX": "Semiconductors",
    "KBE": "Banks",
    "GLD": "Gold",
    "SLV": "Silver",
    "XBI": "Biotech",
    "XPH": "Pharma",
    "IHI": "Medical Devices",
    "XRT": "Retail",
    "JETS": "Airlines",
    "XTN": "Transport",
    "ITA": "Aerospace & Defense",
    "XME": "Metals & Mining",
}


def sector_verdict(score: float, persistence: float, trending: str, rel_1d: float) -> str:
    if score >= 65 and persistence >= 0.6:
        return "bullish"
    if score >= 58 and trending == "strengthening" and persistence >= 0.4:
        return "bullish"
    if score <= 35 and persistence <= 0.4:
        return "bearish"
    if score <= 42 and trending == "fading":
        return "bearish"
    if score >= 65 and persistence < 0.4:
        return "neutral"
    if score >= 55 and trending == "fading" and persistence < 0.5:
        return "neutral"
    _ = rel_1d
    return "neutral"


def compute_persistence(returns: list[DailyReturn]) -> tuple[float, int]:
    if not returns:
        return 0.5, 0
    sessions = returns[-5:]
    leading = sum(1 for r in sessions if r.outperformed)
    return leading / len(sessions), leading


def compute_acceleration(returns: list[DailyReturn]) -> float:
    sessions = returns[-5:] if len(returns) >= 5 else []
    if len(sessions) < 5:
        return 0.0
    recent = sessions[-2:]
    prior = sessions[-5:-2]
    recent_avg = sum(r.relative for r in recent) / 2
    prior_avg = sum(r.relative for r in prior) / 3
    raw = recent_avg - prior_avg
    return max(-2.0, min(2.0, raw))


def rank_etf_among_peers(
    etf: str,
    metric_fn,
    all_sector_data: dict[str, list[DailyReturn]],
) -> float:
    values: dict[str, float] = {}
    for ticker, ret_list in all_sector_data.items():
        if ret_list:
            try:
                values[ticker] = float(metric_fn(ret_list))
            except (IndexError, ZeroDivisionError):
                values[ticker] = 0.0
    if len(values) <= 1:
        return 0.5
    sorted_etfs = sorted(values.keys(), key=lambda t: values[t])
    if etf not in sorted_etfs:
        return 0.5
    position = sorted_etfs.index(etf)
    denom = len(sorted_etfs) - 1
    return 1.0 if denom == 0 else position / denom


def build_interpretation_chip(
    etf: str,
    sessions_leading: int,
    total_sessions: int,
    persistence: float,
    trending: str,
    rel_1d: float,
    mode: str = "swing",
) -> str:
    name = ETF_DISPLAY_NAMES.get(etf, etf)
    if not total_sessions:
        return f"{name} — data loading"
    if mode == "day":
        if rel_1d > 0.5:
            return f"{name} leading today"
        if rel_1d > 0:
            return f"{name} slight edge today"
        if rel_1d < -0.5:
            return f"{name} lagging today"
        return f"{name} in line with market"
    if persistence >= 0.8:
        if trending == "strengthening":
            return f"{name} dominant — {sessions_leading} straight sessions ↗"
        if trending == "fading":
            return f"{name} extended — leadership pace slowing ↘"
        return f"{name} leading {sessions_leading} of {total_sessions} sessions →"
    if persistence >= 0.6:
        if trending == "strengthening":
            return f"{name} emerging leader ({sessions_leading}-day) ↗"
        return f"{name} moderate leadership ({sessions_leading} of {total_sessions} days)"
    if persistence >= 0.4:
        if rel_1d > 0:
            return f"{name} bounce — not trend confirmation yet"
        return f"{name} mixed momentum"
    if rel_1d > 0:
        return f"{name} today only — no multi-day trend"
    return f"{name} lagging — {sessions_leading} of {total_sessions} days leading"


def compute_swing_sector_score(
    etf: str,
    sector_key: str,
    sector_returns: list[DailyReturn],
    all_sector_data: dict[str, list[DailyReturn]],
) -> SectorMomentumScore:
    display = ETF_DISPLAY_NAMES.get(etf, etf)
    if not sector_returns:
        return _neutral_score(etf, sector_key, display)

    persistence, sessions_leading = compute_persistence(sector_returns)
    acceleration = compute_acceleration(sector_returns)
    rel_1d = sector_returns[-1].relative
    rel_5d = sum(r.relative for r in sector_returns[-5:])

    rank_1d = rank_etf_among_peers(
        etf,
        lambda ret: ret[-1].relative if ret else 0.0,
        all_sector_data,
    )
    rank_5d = rank_etf_among_peers(
        etf,
        lambda ret: sum(r.relative for r in ret[-5:]),
        all_sector_data,
    )
    accel_norm = (acceleration + 2.0) / 4.0
    raw_score = 0.35 * rank_5d + 0.35 * persistence + 0.20 * rank_1d + 0.10 * accel_norm
    score = round(max(0.0, min(100.0, raw_score * 100)), 1)

    if acceleration > 0.3:
        trending = "strengthening"
    elif acceleration < -0.3:
        trending = "fading"
    else:
        trending = "stable"
    total = min(5, len(sector_returns))
    chip = build_interpretation_chip(
        etf=etf,
        sessions_leading=sessions_leading,
        total_sessions=total,
        persistence=persistence,
        trending=trending,
        rel_1d=rel_1d,
        mode="swing",
    )
    verdict = sector_verdict(score=score, persistence=persistence, trending=trending, rel_1d=rel_1d)
    return SectorMomentumScore(
        etf=etf,
        sector_key=sector_key,
        display_name=display,
        rel_1d=rel_1d,
        rel_5d=rel_5d,
        persistence=persistence,
        acceleration=acceleration,
        sessions_leading=sessions_leading,
        total_sessions=total,
        rank_1d=rank_1d,
        rank_5d=rank_5d,
        score=score,
        trending=trending,
        verdict=verdict,
        interpretation_chip=chip,
        data_available=True,
    )


def compute_day_sector_score(
    etf: str,
    sector_key: str,
    sector_returns: list[DailyReturn],
    all_sector_data: dict[str, list[DailyReturn]],
) -> SectorMomentumScore:
    display = ETF_DISPLAY_NAMES.get(etf, etf)
    if not sector_returns:
        return _neutral_score(etf, sector_key, display)
    persistence, sessions_leading = compute_persistence(sector_returns)
    rel_1d = sector_returns[-1].relative
    rel_5d = sum(r.relative for r in sector_returns[-5:])
    rank_1d = rank_etf_among_peers(
        etf,
        lambda ret: ret[-1].relative if ret else 0.0,
        all_sector_data,
    )
    raw_score = 0.70 * rank_1d + 0.30 * persistence
    score = round(max(0.0, min(100.0, raw_score * 100)), 1)
    total = min(5, len(sector_returns))
    chip = build_interpretation_chip(
        etf=etf,
        sessions_leading=sessions_leading,
        total_sessions=total,
        persistence=persistence,
        trending="stable",
        rel_1d=rel_1d,
        mode="day",
    )
    verdict = sector_verdict(score=score, persistence=persistence, trending="stable", rel_1d=rel_1d)
    return SectorMomentumScore(
        etf=etf,
        sector_key=sector_key,
        display_name=display,
        rel_1d=rel_1d,
        rel_5d=rel_5d,
        persistence=persistence,
        acceleration=0.0,
        sessions_leading=sessions_leading,
        total_sessions=total,
        rank_1d=rank_1d,
        rank_5d=0.5,
        score=score,
        trending="stable",
        verdict=verdict,
        interpretation_chip=chip,
        data_available=True,
    )


def _neutral_score(etf: str, sector_key: str, display: str) -> SectorMomentumScore:
    return SectorMomentumScore(
        etf=etf,
        sector_key=sector_key,
        display_name=display,
        rel_1d=0.0,
        rel_5d=0.0,
        persistence=0.5,
        acceleration=0.0,
        sessions_leading=0,
        total_sessions=0,
        rank_1d=0.5,
        rank_5d=0.5,
        score=50.0,
        trending="stable",
        verdict="neutral",
        interpretation_chip=f"{display} — data loading",
        data_available=False,
    )


def load_momentum_for_etf(
    etf: str,
    sector_key: str,
    *,
    mode: str,
    all_data: dict[str, list[DailyReturn]] | None = None,
) -> SectorMomentumScore:
    """Load cached returns for ``etf`` and compute momentum (neutral if cache empty)."""
    data = all_data if all_data is not None else get_all_cached_sector_data()
    returns = get_cached_sector_returns(etf) or []
    if mode == "swing":
        return compute_swing_sector_score(etf, sector_key, returns, data)
    return compute_day_sector_score(etf, sector_key, returns, data)


def session_details_from_returns(returns: list[DailyReturn], max_sessions: int = 5) -> list[dict]:
    out: list[dict] = []
    for r in returns[-max_sessions:]:
        out.append(
            {
                "date": r.date,
                "relative": round(r.relative, 4),
                "outperformed": r.outperformed,
            }
        )
    return out
