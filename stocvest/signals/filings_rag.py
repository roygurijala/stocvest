"""Filings retrieval (RAG retrieval layer) — ADR-004 POS-AI-10.

Pure, deterministic, network-free retrieval over the multi-section 10-K text produced by
:mod:`stocvest.data.edgar_10k`. Given a set of research queries, it chunks each section,
scores chunks by lexical relevance (query-term frequency, length-normalized), and returns the
top cited passages — each tagged with its section label + source URL.

This is the *retrieval* half of RAG and is deliberately deterministic: the surfaced passages
are verbatim primary-source text (no LLM generation), so there is nothing to hallucinate. It is
**informational only** (``scored: False``) and never touches pillar math. Generative cited
synthesis (Claude over the retrieved passages) + 10-Q / earnings-call transcripts are the
documented next increment.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

# Default research lenses used when the caller does not supply queries. Kept broad + neutral
# (no advice framing) — they steer retrieval toward the passages a long-horizon investor reads.
DEFAULT_RESEARCH_QUERIES: tuple[str, ...] = (
    "revenue growth drivers demand end markets",
    "gross margin operating margin profitability cost",
    "competition competitors market share pricing",
    "risk factors litigation regulation supply chain",
    "capital allocation buyback dividend debt acquisitions",
)

_TOKEN_RE = re.compile(r"[a-z0-9]+")
_SENT_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")

_STOPWORDS: frozenset[str] = frozenset(
    {
        "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "by", "at",
        "as", "is", "are", "be", "our", "we", "its", "it", "this", "that", "these", "those",
        "from", "which", "may", "will", "can", "has", "have", "had", "not", "no", "than",
        "such", "also", "into", "their", "them", "they", "other", "any", "all", "more",
    }
)

_MIN_CHUNK_CHARS = 120
_DEFAULT_CHUNK_CHARS = 700


@dataclass(frozen=True)
class FilingChunk:
    section_id: str
    section_label: str
    source_url: str
    text: str


@dataclass(frozen=True)
class FilingPassage:
    text: str
    section_label: str
    source_url: str
    score: float

    def to_api_dict(self) -> dict[str, object]:
        return {
            "text": self.text,
            "section_label": self.section_label,
            "source_url": self.source_url,
            "score": round(self.score, 4),
        }


@dataclass(frozen=True)
class FilingsDigest:
    symbol: str
    passages: list[FilingPassage]
    source_url: str
    filing_date: str
    form: str

    def to_api_dict(self) -> dict[str, object]:
        return {
            "symbol": self.symbol,
            "passages": [p.to_api_dict() for p in self.passages],
            "source_url": self.source_url,
            "filing_date": self.filing_date,
            "form": self.form,
            "scored": False,  # explicit: retrieved passages never feed the composite
        }


def _tokens(text: str) -> list[str]:
    return [t for t in _TOKEN_RE.findall(text.lower()) if t not in _STOPWORDS and len(t) > 1]


def chunk_sections(
    sections: list[tuple[str, str, str]],
    *,
    source_url: str,
    chunk_chars: int = _DEFAULT_CHUNK_CHARS,
) -> list[FilingChunk]:
    """Split each ``(section_id, label, text)`` into ~``chunk_chars`` sentence-aware chunks."""
    chunks: list[FilingChunk] = []
    for section_id, label, text in sections:
        if not text:
            continue
        sentences = _SENT_SPLIT_RE.split(text.strip())
        buf = ""
        for sent in sentences:
            sent = sent.strip()
            if not sent:
                continue
            if buf and len(buf) + 1 + len(sent) > chunk_chars:
                if len(buf) >= _MIN_CHUNK_CHARS:
                    chunks.append(FilingChunk(section_id, label, source_url, buf.strip()))
                buf = sent
            else:
                buf = f"{buf} {sent}".strip() if buf else sent
        if buf and len(buf) >= _MIN_CHUNK_CHARS:
            chunks.append(FilingChunk(section_id, label, source_url, buf.strip()))
    return chunks


def score_chunk(chunk_tokens: list[str], query_tokens: set[str]) -> float:
    """Length-normalized query-term frequency. 0 when no query term appears."""
    if not chunk_tokens or not query_tokens:
        return 0.0
    hits = sum(1 for t in chunk_tokens if t in query_tokens)
    if hits == 0:
        return 0.0
    return hits / (len(chunk_tokens) ** 0.5)


def retrieve(
    chunks: list[FilingChunk], query: str, *, k: int = 2
) -> list[tuple[FilingChunk, float]]:
    """Top-``k`` chunks for a query by lexical score (stable order on ties)."""
    q = set(_tokens(query))
    scored: list[tuple[float, int, FilingChunk]] = []
    for i, chunk in enumerate(chunks):
        s = score_chunk(_tokens(chunk.text), q)
        if s > 0:
            scored.append((s, i, chunk))
    scored.sort(key=lambda t: (-t[0], t[1]))  # score desc, original order tie-break
    return [(c, s) for s, _i, c in scored[: max(0, k)]]


def build_filings_digest(
    symbol: str,
    sections: list[tuple[str, str, str]],
    *,
    source_url: str,
    filing_date: str = "",
    form: str = "",
    queries: tuple[str, ...] | None = None,
    k_per_query: int = 1,
    max_passages: int = 6,
) -> FilingsDigest | None:
    """Retrieve the top cited passages across the research queries (deduped). ``None`` if empty."""
    chunks = chunk_sections(sections, source_url=source_url)
    if not chunks:
        return None
    lenses = queries if queries is not None else DEFAULT_RESEARCH_QUERIES

    best: dict[str, tuple[FilingChunk, float]] = {}
    for query in lenses:
        for chunk, score in retrieve(chunks, query, k=k_per_query):
            prev = best.get(chunk.text)
            if prev is None or score > prev[1]:
                best[chunk.text] = (chunk, score)

    ordered = sorted(best.values(), key=lambda cs: -cs[1])[: max(0, max_passages)]
    passages = [
        FilingPassage(
            text=chunk.text,
            section_label=chunk.section_label,
            source_url=chunk.source_url,
            score=score,
        )
        for chunk, score in ordered
    ]
    if not passages:
        return None
    return FilingsDigest(
        symbol=symbol.strip().upper(),
        passages=passages,
        source_url=source_url,
        filing_date=filing_date,
        form=form,
    )
