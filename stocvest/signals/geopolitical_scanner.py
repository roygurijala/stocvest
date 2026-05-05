"""
Phase 2c: Geopolitical scanner.

Analyzes market news for geopolitical risk using Claude with a deterministic
fallback path when external inference is unavailable.
"""

from __future__ import annotations

import asyncio
import json
import re
from dataclasses import dataclass
from enum import Enum
from typing import Any

import httpx

from stocvest.data.models import NewsArticle
from stocvest.utils.config import get_settings
from stocvest.utils.logging import get_logger

logger = get_logger(__name__)

ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_VERSION = "2023-06-01"
DEFAULT_MODEL = "claude-sonnet-4-6"  # Claude Sonnet 4.6 (Anthropic Messages API id)


class GeopoliticalRiskLevel(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


@dataclass(frozen=True)
class GeopoliticalRiskAssessment:
    risk_level: GeopoliticalRiskLevel
    risk_score: float          # 0.0 to 1.0
    market_bias: int           # -1 risk-off, 0 neutral, +1 risk-on
    confidence: float          # 0.0 to 1.0
    summary: str
    drivers: list[str]
    impacted_regions: list[str]


class GeopoliticalScanner:
    """
    Claude-backed geopolitical risk scanner.

    Input articles should be canonical NewsArticle models (already normalized by
    data layer), preserving the no-raw-provider-dict contract.
    """

    _RISK_KEYWORDS = {
        "war",
        "conflict",
        "sanction",
        "invasion",
        "missile",
        "attack",
        "tariff",
        "embargo",
        "ceasefire",
        "military",
        "nato",
        "strait",
        "taiwan",
        "middle east",
        "red sea",
        "oil shock",
    }

    def __init__(
        self,
        *,
        model: str = DEFAULT_MODEL,
        timeout_seconds: float = 20.0,
        max_retries: int = 2,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self._settings = get_settings()
        self._model = model
        self._timeout_seconds = timeout_seconds
        self._max_retries = max_retries
        self._http_client = http_client

    async def scan(self, articles: list[NewsArticle]) -> GeopoliticalRiskAssessment:
        """
        Return portfolio-level geopolitical risk assessment from recent headlines.
        """
        if not articles:
            return GeopoliticalRiskAssessment(
                risk_level=GeopoliticalRiskLevel.LOW,
                risk_score=0.0,
                market_bias=0,
                confidence=0.8,
                summary="No articles provided; defaulting to low geopolitical risk.",
                drivers=[],
                impacted_regions=[],
            )

        self._validate_credentials()
        payload = self._build_payload(articles)
        logger.debug("Running geopolitical scan for %d articles", len(articles))

        try:
            response_json = await self._post_to_claude(payload)
            return self._parse_result(response_json)
        except (httpx.HTTPError, KeyError, ValueError, TypeError, json.JSONDecodeError) as exc:
            logger.warning("Geopolitical scan fallback activated reason=%s", type(exc).__name__)
            return self._rule_based_fallback(articles)

    def _validate_credentials(self) -> None:
        if not self._settings.anthropic_api_key:
            raise ValueError("ANTHROPIC_API_KEY is required for geopolitical scanner.")

    def _build_payload(self, articles: list[NewsArticle]) -> dict[str, Any]:
        compact_articles = []
        for article in articles[:30]:
            compact_articles.append(
                {
                    "title": article.title,
                    "description": article.description or "",
                    "source": article.source or "",
                    "tickers": article.tickers,
                }
            )

        prompt = (
            "You are a geopolitical risk analyst for US financial markets.\n"
            "Given the news items, estimate current geopolitical market risk.\n"
            "Return strict JSON only with keys: risk_level, risk_score, market_bias, "
            "confidence, summary, drivers, impacted_regions.\n"
            "risk_level: low|medium|high\n"
            "risk_score: float 0.0-1.0\n"
            "market_bias: -1 (risk-off), 0 (neutral), 1 (risk-on)\n"
            "confidence: float 0.0-1.0\n"
            "summary: <= 240 chars\n"
            "drivers: list of short strings\n"
            "impacted_regions: list of region strings\n\n"
            f"articles_json={json.dumps(compact_articles)}"
        )

        return {
            "model": self._model,
            "max_tokens": 450,
            "temperature": 0,
            "messages": [{"role": "user", "content": prompt}],
        }

    async def _post_to_claude(self, payload: dict[str, Any]) -> dict[str, Any]:
        headers = {
            "x-api-key": self._settings.anthropic_api_key,
            "anthropic-version": ANTHROPIC_VERSION,
            "content-type": "application/json",
        }

        last_error: Exception | None = None
        last_status: int | None = None
        last_body_snippet = ""
        from stocvest.utils.api_rate_limits import await_claude_api_slot

        for attempt in range(self._max_retries + 1):
            try:
                await await_claude_api_slot()
                response = await self._send_request(headers, payload)
            except httpx.RequestError as exc:
                last_error = exc
                if attempt >= self._max_retries:
                    break
                await asyncio.sleep(0.5 * (2**attempt))
                continue

            if response.status_code in (429, 500, 502, 503, 504) and attempt < self._max_retries:
                last_status = response.status_code
                last_body_snippet = response.text[:200]
                await asyncio.sleep(0.5 * (2**attempt))
                continue

            if response.status_code >= 400:
                raise httpx.HTTPError(
                    f"Geopolitical scanner request failed status={response.status_code} body={response.text[:200]}"
                )
            return response.json()

        if last_status is not None:
            raise httpx.HTTPError(
                f"Geopolitical scanner request failed after retries status={last_status} body={last_body_snippet}"
            )
        raise httpx.HTTPError(
            f"Geopolitical scanner request failed after retries: {type(last_error).__name__}"
        )

    async def _send_request(
        self, headers: dict[str, str], payload: dict[str, Any]
    ) -> httpx.Response:
        if self._http_client is not None:
            return await self._http_client.post(
                ANTHROPIC_API_URL,
                headers=headers,
                json=payload,
                timeout=self._timeout_seconds,
            )
        async with httpx.AsyncClient(timeout=self._timeout_seconds) as client:
            return await client.post(
                ANTHROPIC_API_URL,
                headers=headers,
                json=payload,
            )

    def _parse_result(self, response_json: dict[str, Any]) -> GeopoliticalRiskAssessment:
        content = response_json.get("content", [])
        if not content:
            raise ValueError("Claude response content missing text payload.")

        text_blocks = [
            block.get("text", "") for block in content if isinstance(block, dict) and "text" in block
        ]
        raw_text = "\n".join(part.strip() for part in text_blocks if part and part.strip())
        if not raw_text:
            raise ValueError("Claude response content missing text payload.")

        parsed = self._load_json_from_text(raw_text)

        risk_level_raw = str(parsed["risk_level"]).strip().lower()
        if risk_level_raw not in {lvl.value for lvl in GeopoliticalRiskLevel}:
            raise ValueError(f"Invalid risk_level: {risk_level_raw}")

        risk_score = max(0.0, min(1.0, float(parsed["risk_score"])))
        market_bias_raw = int(parsed["market_bias"])
        market_bias = 1 if market_bias_raw > 0 else (-1 if market_bias_raw < 0 else 0)
        confidence = max(0.0, min(1.0, float(parsed["confidence"])))
        summary = str(parsed.get("summary", "")).strip()[:240]
        drivers = self._normalize_str_list(parsed.get("drivers", []))
        impacted_regions = self._normalize_str_list(parsed.get("impacted_regions", []))

        return GeopoliticalRiskAssessment(
            risk_level=GeopoliticalRiskLevel(risk_level_raw),
            risk_score=risk_score,
            market_bias=market_bias,
            confidence=confidence,
            summary=summary,
            drivers=drivers,
            impacted_regions=impacted_regions,
        )

    def _rule_based_fallback(self, articles: list[NewsArticle]) -> GeopoliticalRiskAssessment:
        joined = " ".join(
            f"{article.title} {article.description or ''}".lower() for article in articles
        )
        matches = sorted(keyword for keyword in self._RISK_KEYWORDS if keyword in joined)

        if not matches:
            return GeopoliticalRiskAssessment(
                risk_level=GeopoliticalRiskLevel.LOW,
                risk_score=0.15,
                market_bias=0,
                confidence=0.55,
                summary="No major geopolitical catalysts detected in current article set.",
                drivers=[],
                impacted_regions=[],
            )

        score = min(1.0, 0.25 + 0.08 * len(matches))
        if score >= 0.75:
            level = GeopoliticalRiskLevel.HIGH
        elif score >= 0.4:
            level = GeopoliticalRiskLevel.MEDIUM
        else:
            level = GeopoliticalRiskLevel.LOW

        return GeopoliticalRiskAssessment(
            risk_level=level,
            risk_score=score,
            market_bias=-1,
            confidence=0.65,
            summary="Rule-based fallback identified elevated geopolitical risk keywords.",
            drivers=matches[:5],
            impacted_regions=[],
        )

    @staticmethod
    def _load_json_from_text(text: str) -> dict[str, Any]:
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            match = re.search(r"\{.*\}", text, flags=re.DOTALL)
            if not match:
                raise
            return json.loads(match.group(0))

    @staticmethod
    def _normalize_str_list(value: Any) -> list[str]:
        if not isinstance(value, list):
            return []
        return [str(item).strip() for item in value if str(item).strip()]
