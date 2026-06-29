"""
Web-search context for the STOCVEST Assistant (Perplexity Sonar).

Answers "out-of-envelope" questions that STOCVEST's structured Polygon/Benzinga
symbol data cannot — macro, policy, sector/thematic, "what's the latest on …".
The handler consults this only as a FALLBACK (no symbol / discovery / market /
watchlist context this turn) and only when the feature flag is on.

Design notes:
- Reuses the shared :func:`perplexity_sonar_json` client (same one the signal
  engine uses), so caching (Upstash), timeout, and the API key are all shared.
- The result is ALWAYS citation-backed; the handler surfaces the sources as
  chips and the locked prompt's WEB CONTEXT rules force factual, no-verdict
  framing. We never turn a web answer into a buy/sell call or price prediction.
- Best-effort: any failure (no key, bad JSON, timeout) returns ``None`` and the
  assistant answers from general knowledge without a web block.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field

from stocvest.data.perplexity_client import perplexity_cache_key, perplexity_sonar_json
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

WEB_CONTEXT_BLOCK_HEADER = "=== WEB CONTEXT (live web search; cite the sources) ==="


@dataclass
class AssistantWebContext:
    """A cited web-search answer for a single out-of-envelope question."""

    query: str
    answer: str = ""
    key_points: list[str] = field(default_factory=list)
    sources: list[dict] = field(default_factory=list)  # {"title", "url"}

    @property
    def has_data(self) -> bool:
        return bool(self.answer)


def _normalize_str_list(raw: object, *, limit: int = 5, clip: int = 240) -> list[str]:
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    for row in raw:
        text = str(row or "").strip()
        if text and text not in out:
            out.append(text[:clip])
        if len(out) >= limit:
            break
    return out


def _normalize_sources(raw: object, *, limit: int = 6) -> list[dict]:
    """Coerce the model's ``sources`` into a clean ``[{title, url}]`` list.

    Accepts either dicts ({"title","url"}) or bare strings ("Publisher — url").
    """
    if not isinstance(raw, list):
        return []
    out: list[dict] = []
    seen: set[str] = set()
    for row in raw:
        title = ""
        url = ""
        if isinstance(row, dict):
            title = str(row.get("title") or row.get("name") or row.get("source") or "").strip()
            url = str(row.get("url") or row.get("link") or "").strip()
        elif isinstance(row, str):
            title = row.strip()
        if not title and not url:
            continue
        key = (url or title).lower()
        if key in seen:
            continue
        seen.add(key)
        entry: dict = {}
        if title:
            entry["title"] = title[:200]
        if url.startswith("http"):
            entry["url"] = url[:500]
        if entry:
            out.append(entry)
        if len(out) >= limit:
            break
    return out


def _query_cache_token(query: str) -> str:
    """Stable short token for a normalized query, used as the cache-key slot."""
    norm = " ".join((query or "").strip().lower().split())
    return hashlib.sha1(norm.encode("utf-8")).hexdigest()[:16]  # noqa: S324 - cache key only


async def fetch_web_context(query: str) -> AssistantWebContext | None:
    """Fetch a cited, up-to-date web answer for *query*, or ``None`` on failure."""
    q = (query or "").strip()
    if not q:
        return None
    q = q[:400]

    prompt = f"""You are a financial-markets research assistant. Answer the user's question \
below with a concise, factual, up-to-date summary grounded in reputable sources. \
Be neutral and descriptive. Do NOT give buy/sell/hold advice, position sizing, or \
price predictions — report what is happening and why, not what anyone should do.

Question: {q}

Return ONLY valid JSON:
{{
  "answer": "3-5 sentence neutral, factual summary",
  "key_points": ["short factual point", "..."],
  "sources": [{{"title": "publisher or headline", "url": "https://..."}}]
}}

Use [] when none apply. Max 5 key_points and 6 sources."""

    try:
        data = await perplexity_sonar_json(
            prompt=prompt,
            search_recency_filter="week",
            cache_key=perplexity_cache_key("assistant_web", _query_cache_token(q)),
        )
    except Exception as exc:  # noqa: BLE001 — web context is best-effort
        _LOG.warning("assistant_web_context fetch failed: %s", type(exc).__name__)
        return None
    if not data:
        return None
    answer = str(data.get("answer") or "").strip()
    if not answer:
        return None
    return AssistantWebContext(
        query=q,
        answer=answer[:1200],
        key_points=_normalize_str_list(data.get("key_points")),
        sources=_normalize_sources(data.get("sources")),
    )


def serialize_web_context(ctx: AssistantWebContext | None) -> str:
    """Render the web answer as a system-message block for the assistant."""
    if not ctx or not ctx.has_data:
        return ""
    lines: list[str] = [WEB_CONTEXT_BLOCK_HEADER, f"answer={ctx.answer}"]
    if ctx.key_points:
        lines.append("key_points:")
        for kp in ctx.key_points:
            lines.append(f"  - {kp}")
    if ctx.sources:
        lines.append("sources:")
        for s in ctx.sources:
            title = s.get("title") or s.get("url") or ""
            url = s.get("url") or ""
            lines.append(f"  - {title} {url}".rstrip())
    lines.append("")  # trailing newline
    return "\n".join(lines)


def web_sources_payload(ctx: AssistantWebContext | None) -> list[dict] | None:
    """Return the source chips for the response payload, or ``None`` when empty."""
    if not ctx or not ctx.sources:
        return None
    return [dict(s) for s in ctx.sources]
