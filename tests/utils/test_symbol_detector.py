"""Tests for stocvest.utils.symbol_detector.

Covers detect_symbol (single-text) and detect_symbol_from_messages (multi-turn).
"""

from __future__ import annotations

import pytest

from stocvest.utils.symbol_detector import (
    detect_symbol,
    detect_symbol_from_messages,
    extract_action_symbol,
    extract_company_lookup_phrase,
)


# ─────────────────────────────────────────────────────────────────────────────
# detect_symbol — dollar-sign tickers
# ─────────────────────────────────────────────────────────────────────────────


def test_dollar_sign_ticker_detected() -> None:
    assert detect_symbol("why is $MRVL up today?") == "MRVL"


def test_dollar_sign_takes_priority_over_bare_word() -> None:
    """$NVDA in the same sentence as another uppercase word → dollar-sign wins."""
    assert detect_symbol("AAPL is down but $NVDA is surging") == "NVDA"


def test_dollar_sign_two_tickers_returns_last() -> None:
    assert detect_symbol("$AAPL dropped but $NVDA rallied") == "NVDA"


def test_dollar_sign_lowercase_message_upcased() -> None:
    assert detect_symbol("why is $mrvl up?") == "MRVL"


def test_bare_ticker_lowercase_detected() -> None:
    """Users often type tickers in lowercase — 'mrvl', 'nvda', 'aapl'."""
    assert detect_symbol("can you explain why mrvl increased today?") == "MRVL"


def test_bare_ticker_mixed_case_detected() -> None:
    assert detect_symbol("what is happening with Nvda") == "NVDA"


# ─────────────────────────────────────────────────────────────────────────────
# detect_symbol — bare uppercase tickers
# ─────────────────────────────────────────────────────────────────────────────


def test_bare_ticker_detected() -> None:
    assert detect_symbol("why is MRVL up today?") == "MRVL"


def test_bare_ticker_returns_last_mentioned() -> None:
    """When multiple tickers appear, last one is the subject of the question."""
    assert detect_symbol("I have AAPL and TSLA but I want to know about NVDA") == "NVDA"


def test_two_letter_ticker_detected() -> None:
    # GS (Goldman Sachs) is a valid 2-letter ticker not in the blocklist.
    assert detect_symbol("what is GS doing today?") == "GS"


def test_five_letter_ticker_detected() -> None:
    assert detect_symbol("GOOGL is near its 52-week high") == "GOOGL"


# ─────────────────────────────────────────────────────────────────────────────
# detect_symbol — blocklist (common English words / finance abbreviations)
# ─────────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("text", [
    "I want to know what is going on",
    "is this a good setup",
    "how does the ETF work",
    "what is the IPO date",
    "can you explain RSI to me",
    "the EMA is crossing over",
    "what does VWAP mean",
    "we are in a risk on environment",
])
def test_blocklist_words_not_detected(text: str) -> None:
    assert detect_symbol(text) is None


def test_ai_not_detected_as_ticker() -> None:
    assert detect_symbol("what do AI stocks look like today?") is None


def test_vix_not_detected_as_ticker() -> None:
    """VIX is a well-known acronym but not a directly tradable equity ticker."""
    assert detect_symbol("VIX is elevated above 20") is None


# ─────────────────────────────────────────────────────────────────────────────
# detect_symbol — edge cases
# ─────────────────────────────────────────────────────────────────────────────


def test_empty_string_returns_none() -> None:
    assert detect_symbol("") is None


def test_none_like_whitespace_returns_none() -> None:
    assert detect_symbol("   ") is None


def test_no_ticker_in_text_returns_none() -> None:
    assert detect_symbol("why is the market down today?") is None


def test_six_letter_word_not_detected() -> None:
    """Ticker symbols are max 5 chars; longer words must never match."""
    assert detect_symbol("AMAZON is doing well") is None


# ─────────────────────────────────────────────────────────────────────────────
# detect_symbol_from_messages — multi-turn fallback
# ─────────────────────────────────────────────────────────────────────────────


def test_detects_symbol_from_last_user_message() -> None:
    messages = [
        {"role": "user", "content": "why is MRVL up today?"},
    ]
    assert detect_symbol_from_messages(messages) == "MRVL"


def test_falls_back_to_prior_user_message() -> None:
    """Follow-up like 'why did it gap up?' has no ticker — look at prior turn."""
    messages = [
        {"role": "user", "content": "tell me about NVDA"},
        {"role": "assistant", "content": "NVDA is a semiconductor company."},
        {"role": "user", "content": "why did it gap up?"},
    ]
    assert detect_symbol_from_messages(messages) == "NVDA"


def test_last_user_message_ticker_wins_over_earlier() -> None:
    messages = [
        {"role": "user", "content": "tell me about AAPL"},
        {"role": "assistant", "content": "Sure."},
        {"role": "user", "content": "actually what about TSLA?"},
    ]
    assert detect_symbol_from_messages(messages) == "TSLA"


def test_empty_messages_returns_none() -> None:
    assert detect_symbol_from_messages([]) is None


def test_non_list_messages_returns_none() -> None:
    assert detect_symbol_from_messages(None) is None  # type: ignore[arg-type]


def test_only_assistant_messages_returns_none() -> None:
    """Only assistant turns present — no user intent to scan."""
    messages = [{"role": "assistant", "content": "MRVL is a chip maker."}]
    assert detect_symbol_from_messages(messages) is None


# ─────────────────────────────────────────────────────────────────────────────
# extract_action_symbol — explicit add/remove actions (blocklist bypass)
# ─────────────────────────────────────────────────────────────────────────────


def test_action_symbol_extracts_blocklisted_ticker_pe() -> None:
    """'PE' is a blocklisted abbreviation but a valid ticker when named explicitly."""
    assert extract_action_symbol("add PE to my watchlist") == "PE"


def test_action_symbol_extracts_lowercase_remove() -> None:
    assert extract_action_symbol("remove mrvl from my watchlist") == "MRVL"


def test_action_symbol_extracts_ev_on_add() -> None:
    assert extract_action_symbol("can you add EV to my watchlist") == "EV"


def test_action_symbol_dollar_sign_wins() -> None:
    assert extract_action_symbol("add $AAPL to my watchlist") == "AAPL"


def test_action_symbol_skips_pronoun_then_falls_back() -> None:
    # "add it to my watchlist" — no real ticker; should not return a stopword.
    assert extract_action_symbol("add it to my watchlist") is None


def test_action_symbol_watch_verb() -> None:
    assert extract_action_symbol("watch TSLA") == "TSLA"


def test_action_symbol_no_verb_falls_back_to_detect() -> None:
    # No action verb — behaves like detect_symbol.
    assert extract_action_symbol("why is NVDA up today?") == "NVDA"


def test_scans_at_most_three_user_turns() -> None:
    """Only the last 3 user turns are checked — older context is ignored."""
    messages = [
        {"role": "user", "content": "tell me about AAPL"},   # turn 1 — too old
        {"role": "assistant", "content": "ok"},
        {"role": "user", "content": "interesting"},            # turn 2 — no ticker
        {"role": "assistant", "content": "yes"},
        {"role": "user", "content": "interesting"},            # turn 3 — no ticker
        {"role": "assistant", "content": "yes"},
        {"role": "user", "content": "interesting"},            # turn 4 — no ticker
        {"role": "assistant", "content": "yes"},
        {"role": "user", "content": "tell me more"},           # turn 5 (last) — no ticker
    ]
    # AAPL is only in turn 1, which is beyond the 3-turn look-back window
    assert detect_symbol_from_messages(messages) is None


# ─────────────────────────────────────────────────────────────────────────────
# extract_company_lookup_phrase — company-name fallback for symbol-directed Qs
# ─────────────────────────────────────────────────────────────────────────────


def test_company_phrase_extracted_from_performance_question() -> None:
    assert extract_company_lookup_phrase("can you tell me how marvel performed today") == "marvel"


def test_company_phrase_extracted_for_news_question() -> None:
    assert extract_company_lookup_phrase("any news on palantir?") == "palantir"


def test_company_phrase_none_for_market_overview() -> None:
    # Market-level subject → not a single-company lookup.
    assert extract_company_lookup_phrase("how is the market doing today") is None


def test_company_phrase_none_for_concept_question() -> None:
    # No symbol-directed cue / only generic words → no candidate.
    assert extract_company_lookup_phrase("what is a p/e ratio and how is it used") is None


def test_company_phrase_none_without_cue() -> None:
    assert extract_company_lookup_phrase("hello there friend") is None


def test_company_phrase_multiword_kept() -> None:
    assert extract_company_lookup_phrase("how did palo alto perform today") == "palo alto"


def test_company_phrase_strips_forecast_framing() -> None:
    # Trailing "forecast for next few days" must not pollute the company name.
    assert (
        extract_company_lookup_phrase("how did broadcom do today what is its forecast for next few days")
        == "broadcom"
    )


def test_company_phrase_forecast_question_resolves_name() -> None:
    # "what is the forecast of broadcom" must trigger the company lookup (forecast
    # is a single-instrument cue) so it resolves AVGO instead of falling back to a
    # stale prior-turn ticker.
    assert extract_company_lookup_phrase("what is the forecast of broadcom") == "broadcom"


def test_company_phrase_outlook_and_target_cues() -> None:
    assert extract_company_lookup_phrase("outlook on broadcom") == "broadcom"
    assert extract_company_lookup_phrase("whats the price target for palantir") == "palantir"
    assert extract_company_lookup_phrase("analyst consensus for shake shack") == "shake shack"


def test_company_phrase_stocvest_think_framing_stripped() -> None:
    # "what does STOCVEST think of X" keeps only the company name.
    assert extract_company_lookup_phrase("what does stocvest think of broadcom") == "broadcom"


def test_company_phrase_forecast_market_level_still_none() -> None:
    # Forecast cue + market-level subject is still not a single-company lookup.
    assert extract_company_lookup_phrase("what is the outlook for the market") is None
