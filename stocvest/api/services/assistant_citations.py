"""
Source-citation builder for the STOCVEST Assistant.

When the assistant answers a live-symbol question ("why is X moving?"), it has
already fetched recent Polygon news (and optional Perplexity supplements). We
surface those underlying sources to the user as numbered citation chips so the
synthesis is verifiable — the same transparency Aime provides with its [1][2]
references.

Deliberately read-only and defensive: any malformed item is skipped, and we only
emit items that carry a real http(s) URL the user can open.
"""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:  # avoid import cycle / heavy import at module load
    from stocvest.api.services.assistant_symbol_context import AssistantSymbolContext

# More than a handful of chips turns into clutter; the model already leads with
# the single most relevant catalyst, so the chips are supporting evidence only.
_MAX_CITATIONS = 4


def _is_http_url(value: Any) -> bool:
    return isinstance(value, str) and (value.startswith("http://") or value.startswith("https://"))


def _iso(dt: Any) -> str | None:
    if isinstance(dt, datetime):
        return dt.isoformat().replace("+00:00", "Z")
    return None


def build_citations(ctx: "AssistantSymbolContext | None") -> list[dict] | None:
    """Build a de-duplicated, recency-ordered list of source citations.

    Returns None when there are no linkable sources so the UI renders nothing.
    """
    if ctx is None:
        return None

    from stocvest.api.services.assistant_symbol_context import news_relevance_rank

    symbol = str(getattr(ctx, "symbol", "") or "")

    candidates: list[tuple[int, datetime | None, dict]] = []
    seen_urls: set[str] = set()

    def _add(*, title: Any, url: Any, source: Any, published: Any, relevance: int) -> None:
        if not _is_http_url(url):
            return
        url_s = str(url)
        if url_s in seen_urls:
            return
        title_s = str(title or "").strip()
        if not title_s:
            return
        seen_urls.add(url_s)
        published_dt = published if isinstance(published, datetime) else None
        candidates.append(
            (
                relevance,
                published_dt,
                {
                    "title": title_s[:160],
                    "url": url_s,
                    "source": (str(source).strip() or "news")[:40],
                    "published_at": _iso(published_dt),
                },
            )
        )

    # Legacy Benzinga channel-tagged coverage (manual/test payloads only).
    for art in getattr(ctx, "benzinga_news", []) or []:
        _add(
            title=getattr(art, "title", None),
            url=getattr(art, "url", None),
            source=getattr(art, "source", None) or "Benzinga",
            published=getattr(art, "published_at", None),
            relevance=0,
        )
    px_news = getattr(ctx, "perplexity_news", None)
    if px_news is not None:
        for cite in getattr(px_news, "citations", []) or []:
            text = str(cite or "").strip()
            if not text:
                continue
            url = text if _is_http_url(text) else None
            if url is None and "http" in text:
                # "Publisher — https://..." form from Perplexity JSON.
                for part in text.replace("—", "-").split("-"):
                    part = part.strip()
                    if _is_http_url(part):
                        url = part
                        break
            _add(
                title=text.split("http", 1)[0].strip(" -—") or text[:80],
                url=url,
                source="Perplexity",
                published=None,
                relevance=1,
            )
    for art in getattr(ctx, "news", []) or []:
        _add(
            title=getattr(art, "title", None),
            url=getattr(art, "url", None),
            source=getattr(art, "source", None) or getattr(art, "company_name", None) or "news",
            published=getattr(art, "published_at", None),
            relevance=news_relevance_rank(symbol, getattr(art, "tickers", None), getattr(art, "title", None)),
        )

    if not candidates:
        return None

    # On-target first (relevance asc), then most recent first. Epoch seconds keep
    # mixed aware/naive datetimes from triggering a comparison TypeError.
    def _key(item: tuple[int, datetime | None, dict]) -> tuple[int, float]:
        relevance, dt, _payload = item
        ts = float("-inf")
        if dt is not None:
            try:
                ts = dt.timestamp()
            except (OverflowError, OSError, ValueError):
                ts = float("-inf")
        return (relevance, -ts)

    candidates.sort(key=_key)
    return [payload for _r, _dt, payload in candidates[:_MAX_CITATIONS]]
