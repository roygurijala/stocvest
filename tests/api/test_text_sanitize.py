from __future__ import annotations

from stocvest.api.text_sanitize import sanitize_free_text, sanitize_optional_free_text, sanitize_strategy_tags


def test_sanitize_free_text_strips_nul_and_trims() -> None:
    assert sanitize_free_text("  hi\x00 ", max_len=10) == "hi"


def test_sanitize_free_text_truncates() -> None:
    assert len(sanitize_free_text("x" * 100, max_len=5)) == 5


def test_sanitize_optional_free_text_none_and_blank() -> None:
    assert sanitize_optional_free_text(None, max_len=10) is None
    assert sanitize_optional_free_text("  \n  ", max_len=10) is None


def test_sanitize_strategy_tags_caps_count_and_length() -> None:
    raw = ["a" * 100, "ok", "", "  "]
    tags = sanitize_strategy_tags(raw, per_tag_max=8, max_tags=2)
    assert tags == ("aaaaaaaa", "ok")
