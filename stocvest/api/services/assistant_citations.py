"""
Source-citation builder for the STOCVEST Assistant.

When the assistant answers a live-symbol question ("why is X moving?"), it has
already fetched recent news + Benzinga coverage. We surface those underlying
sources to the user as numbered citation chips so the synthesis is verifiable —
the same transparency Aime provides with its [1][2] references.

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

    candidates: list[tuple[datetime | None, dict]] = []
    seen_urls: set[str] = set()

    def _add(*, title: Any, url: Any, source: Any, published: Any) -> None:
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
                published_dt,
                {
                    "title": title_s[:160],
                    "url": url_s,
                    "source": (str(source).strip() or "news")[:40],
                    "published_at": _iso(published_dt),
                },
            )
        )

    # Benzinga channel-tagged coverage tends to be the most market-relevant.
    for art in getattr(ctx, "benzinga_news", []) or []:
        _add(
            title=getattr(art, "title", None),
            url=getattr(art, "url", None),
            source=getattr(art, "source", None) or "Benzinga",
            published=getattr(art, "published_at", None),
        )
    for art in getattr(ctx, "news", []) or []:
        _add(
            title=getattr(art, "title", None),
            url=getattr(art, "url", None),
            source=getattr(art, "source", None) or getattr(art, "company_name", None) or "news",
            published=getattr(art, "published_at", None),
        )

    if not candidates:
        return None

    # Most recent first; undated items sink to the bottom. Use epoch seconds so
    # mixed aware/naive datetimes never trigger a comparison TypeError.
    def _key(pair: tuple[datetime | None, dict]) -> float:
        dt = pair[0]
        if dt is None:
            return float("-inf")
        try:
            return dt.timestamp()
        except (OverflowError, OSError, ValueError):
            return float("-inf")

    candidates.sort(key=_key, reverse=True)
    return [item for _dt, item in candidates[:_MAX_CITATIONS]]
