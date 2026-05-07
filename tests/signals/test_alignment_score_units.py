from stocvest.signals.alignment_score import (
    AlignmentLevel,
    AlignmentResult,
    apply_alignment_modifier,
    compute_alignment_score,
)


def test_full_alignment_long() -> None:
    r = compute_alignment_score(
        macro_verdict="bullish",
        macro_regime="neutral",
        sector_verdict="bullish",
        sector_persistence=0.5,
        technical_verdict="bullish",
        signal_direction="long",
    )
    assert r.level == AlignmentLevel.FULL
    assert r.score_modifier >= 12
    assert r.is_tailwind is True
    assert r.is_counter_trend is False


def test_full_alignment_persistence_bonus() -> None:
    r = compute_alignment_score(
        macro_verdict="bullish",
        macro_regime="neutral",
        sector_verdict="bullish",
        sector_persistence=0.9,
        technical_verdict="bullish",
        signal_direction="long",
    )
    assert r.score_modifier > 12


def test_macro_conflict_long() -> None:
    r = compute_alignment_score(
        macro_verdict="bearish",
        macro_regime="neutral",
        sector_verdict="neutral",
        technical_verdict="bullish",
        sector_persistence=0.5,
        signal_direction="long",
    )
    assert r.level == AlignmentLevel.CONFLICT
    assert r.score_modifier <= -10
    assert r.is_counter_trend is True


def test_apply_modifier_clamp() -> None:
    a = AlignmentResult(
        level=AlignmentLevel.FULL,
        score_modifier=14.0,
        macro_supports=True,
        sector_supports=True,
        technical_supports=True,
        macro_direction="bullish",
        sector_direction="bullish",
        technical_direction="bullish",
        is_tailwind=True,
        is_headwind=False,
        is_counter_trend=False,
        alignment_label="x",
        alignment_detail="y",
        alignment_chip="z",
    )
    assert apply_alignment_modifier(92.0, a) == 100.0
    b = AlignmentResult(
        level=AlignmentLevel.CONFLICT,
        score_modifier=-12.0,
        macro_supports=False,
        sector_supports=True,
        technical_supports=True,
        macro_direction="bearish",
        sector_direction="bullish",
        technical_direction="bullish",
        is_tailwind=False,
        is_headwind=True,
        is_counter_trend=True,
        alignment_label="x",
        alignment_detail="y",
        alignment_chip="z",
    )
    assert apply_alignment_modifier(8.0, b) >= 0.0
