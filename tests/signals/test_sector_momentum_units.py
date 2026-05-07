from stocvest.workers.sector_daily_cache import DailyReturn

from stocvest.signals.sector_momentum import (
    compute_acceleration,
    compute_persistence,
    compute_swing_sector_score,
    rank_etf_among_peers,
    sector_verdict,
)


def test_persistence_five_of_five() -> None:
    drs = [DailyReturn("2024-01-0%d" % i, 0, 0, 0.5, True, 1) for i in range(1, 6)]
    p, n = compute_persistence(drs)
    assert abs(p - 1.0) < 1e-9 and n == 5


def test_persistence_empty_default() -> None:
    p, n = compute_persistence([])
    assert abs(p - 0.5) < 1e-9 and n == 0


def test_acceleration_requires_five() -> None:
    drs = [DailyReturn("d", 0, 0, 0.1, True, 1)] * 3
    assert compute_acceleration(drs) == 0.0


def test_acceleration_strengthening() -> None:
    drs = [
        DailyReturn("1", 0, 0, 0.2, True, 1),
        DailyReturn("2", 0, 0, 0.2, True, 1),
        DailyReturn("3", 0, 0, 0.2, True, 1),
        DailyReturn("4", 0, 0, 1.2, True, 1),
        DailyReturn("5", 0, 0, 1.2, True, 1),
    ]
    assert compute_acceleration(drs) > 0


def test_rank_neutral_one_etf() -> None:
    data = {"XLK": [DailyReturn("d", 0, 0, 1.0, True, 1)]}
    r = rank_etf_among_peers("XLK", lambda ret: ret[-1].relative, data)
    assert r == 0.5


def test_swing_neutral_no_data() -> None:
    s = compute_swing_sector_score("XLK", "technology", [], {})
    assert s.score == 50.0
    assert s.data_available is False


def test_sector_verdict_bullish_confirmed() -> None:
    assert sector_verdict(70, 0.7, "stable", 0.1) == "bullish"


def test_sector_verdict_accelerating_fade() -> None:
    assert sector_verdict(40, 0.5, "fading", 0.0) == "bearish"
