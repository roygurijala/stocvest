from stocvest.config.signal_parameters import NewsParameters
from stocvest.signals.news_analyzer import NewsAnalyzer

from tests.signals.conftest import make_negative_articles, make_positive_articles, mock_parameter_store


def test_positive_articles_bullish(mock_parameter_store) -> None:
    n = NewsAnalyzer().analyze("TEST", make_positive_articles(3), mock_parameter_store.news)
    assert n.status == "available"
    assert n.score is not None and n.score >= 65


def test_negative_articles_bearish(mock_parameter_store) -> None:
    n = NewsAnalyzer().analyze("TEST", make_negative_articles(3), mock_parameter_store.news)
    assert n.status == "available"
    assert n.score is not None and n.score <= 40


def test_no_articles_returns_unavailable(mock_parameter_store) -> None:
    n = NewsAnalyzer().analyze("TEST", [], mock_parameter_store.news)
    assert n.status == "unavailable"
    assert n.score is None


def test_pr_wire_filtered(mock_parameter_store) -> None:
    articles = [
        {
            "title": "PR fluff",
            "tickers": ["TEST"],
            "published_utc": "2026-05-04T12:00:00Z",
            "insights": [{"sentiment": "positive"}],
            "publisher": {"name": "PR Newswire"},
        }
    ]
    n = NewsAnalyzer().analyze("TEST", articles, mock_parameter_store.news)
    assert n.status == "unavailable"


def test_params_threshold_used(mock_parameter_store) -> None:
    p = mock_parameter_store.news
    p.bullish_threshold = 70
    n = NewsAnalyzer().analyze("TEST", make_positive_articles(2), p)
    if n.score is not None:
        assert n.verdict != "bullish" or n.score >= 70
