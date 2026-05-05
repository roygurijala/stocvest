"""ECS Fargate news worker: Benzinga websocket + SEC EDGAR 8-K → triage → SQS."""

from __future__ import annotations

import asyncio
import signal
from datetime import datetime, timezone
from typing import Any

import boto3

from stocvest.data.edgar_client import EdgarClient, EdgarFiling, edgar_filing_to_news_article
from stocvest.data.models import NewsArticle
from stocvest.data.news_triage import NewsTriage
from stocvest.data.polygon_client import BenzingaNewsStream
from stocvest.utils.config import get_settings
from stocvest.utils.logging import get_logger

log = get_logger(__name__)


class NewsWorker:
    def __init__(self) -> None:
        self._settings = get_settings()
        self._stop = asyncio.Event()
        self._triage = NewsTriage()
        self._benz_received = 0
        self._benz_passed = 0
        self._benz_dropped = 0
        self._edgar_received = 0
        self._benz_up = 0
        self._lock = asyncio.Lock()
        self._sqs: Any = None
        self._cw: Any = None
        self._queue_url = self._settings.stocvest_news_triage_queue_url.strip()
        self._edgar = EdgarClient()

    def _get_sqs(self) -> Any:
        if self._sqs is None:
            self._sqs = boto3.client("sqs", region_name=self._settings.aws_region)
        return self._sqs

    def _get_cw(self) -> Any:
        if self._cw is None:
            self._cw = boto3.client("cloudwatch", region_name=self._settings.aws_region)
        return self._cw

    async def _publish_to_sqs(self, article: NewsArticle, *, priority: str = "normal") -> None:
        if not self._queue_url:
            log.error("STOCVEST_NEWS_TRIAGE_QUEUE_URL not set; drop article_id=%s", article.article_id)
            return
        body = article.model_dump_json()
        tickers_csv = ",".join(article.tickers)
        attrs = {
            "source": {"DataType": "String", "StringValue": str(article.source or "unknown")},
            "priority": {"DataType": "String", "StringValue": priority},
            # SQS String attributes must be non-empty; use "-" when no ticker is present.
            "tickers": {"DataType": "String", "StringValue": (tickers_csv[:1024] if tickers_csv else "-")},
        }
        sqs = self._get_sqs()
        last_exc: Exception | None = None
        for attempt in range(3):
            try:
                await asyncio.to_thread(
                    sqs.send_message,
                    QueueUrl=self._queue_url,
                    MessageBody=body,
                    MessageAttributes=attrs,
                )
                return
            except Exception as exc:
                last_exc = exc
                log.warning("SQS send attempt %s failed: %s", attempt + 1, exc)
                await asyncio.sleep(1.0)
        log.error("SQS send failed after retries article_id=%s err=%s", article.article_id, last_exc)

    async def _run_benzinga_stream(self) -> None:
        token = self._settings.benzinga_api_key.strip()
        if not token:
            log.error("BENZINGA_API_KEY missing; Benzinga stream disabled")
            self._benz_up = 0
            await self._stop.wait()
            return
        stream = BenzingaNewsStream(
            token,
            self._settings.benzinga_news_ws_url,
            stop_event=self._stop,
        )

        async def on_article(art: NewsArticle) -> None:
            async with self._lock:
                self._benz_received += 1
            ok, reason = self._triage.should_score(art)
            if not ok:
                log.debug("triage drop article_id=%s reason=%s", art.article_id, reason)
                async with self._lock:
                    self._benz_dropped += 1
                return
            async with self._lock:
                self._benz_passed += 1
            await self._publish_to_sqs(art, priority="normal")

        try:
            self._benz_up = 1
            await stream.run(on_article)
        finally:
            self._benz_up = 0

    async def _run_edgar_poller(self) -> None:
        async def on_filing(filing: EdgarFiling) -> None:
            async with self._lock:
                self._edgar_received += 1
            art = edgar_filing_to_news_article(filing)
            await self._publish_to_sqs(art, priority="high")

        try:
            await self._edgar.start_polling(on_filing)
        except asyncio.CancelledError:
            await self._edgar.stop()
            raise

    async def _run_health_reporter(self) -> None:
        ns = self._settings.stocvest_news_worker_cloudwatch_namespace
        hb_key = self._settings.stocvest_news_worker_heartbeat_key
        while not self._stop.is_set():
            try:
                now = datetime.now(timezone.utc).isoformat()
                try:
                    from stocvest.utils.redis_client import get_sync_redis

                    r = get_sync_redis()
                    if r is not None:
                        await asyncio.to_thread(r.setex, hb_key, 90, now)
                except Exception as exc:
                    log.debug("heartbeat redis: %s", exc)

                async with self._lock:
                    br, bp, bd, er, up = (
                        self._benz_received,
                        self._benz_passed,
                        self._benz_dropped,
                        self._edgar_received,
                        self._benz_up,
                    )
                cw = self._get_cw()
                await asyncio.to_thread(
                    cw.put_metric_data,
                    Namespace=ns,
                    MetricData=[
                        {"MetricName": "news_worker.benzinga.articles_received", "Value": float(br), "Unit": "Count"},
                        {"MetricName": "news_worker.benzinga.articles_passed_triage", "Value": float(bp), "Unit": "Count"},
                        {"MetricName": "news_worker.benzinga.articles_dropped", "Value": float(bd), "Unit": "Count"},
                        {"MetricName": "news_worker.edgar.filings_received", "Value": float(er), "Unit": "Count"},
                        {"MetricName": "news_worker.connection.benzinga_status", "Value": float(up), "Unit": "Count"},
                    ],
                )
            except Exception as exc:
                log.warning("health reporter: %s", exc)
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=60.0)
            except TimeoutError:
                pass

    async def start(self) -> None:
        log.info(
            "NewsWorker starting queue=%s ws=%s",
            self._queue_url or "(missing)",
            self._settings.benzinga_news_ws_url,
        )

        def _shutdown() -> None:
            self._stop.set()
            self._edgar.request_stop()

        try:
            loop = asyncio.get_running_loop()
            for sig in (signal.SIGTERM, signal.SIGINT):
                loop.add_signal_handler(sig, _shutdown)
        except (NotImplementedError, RuntimeError):
            try:
                signal.signal(signal.SIGTERM, lambda *_: _shutdown())
                signal.signal(signal.SIGINT, lambda *_: _shutdown())
            except ValueError:
                pass

        tasks = [
            asyncio.create_task(self._run_benzinga_stream()),
            asyncio.create_task(self._run_edgar_poller()),
            asyncio.create_task(self._run_health_reporter()),
        ]
        try:
            await asyncio.gather(*tasks)
        finally:
            _shutdown()
            for t in tasks:
                if not t.done():
                    t.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
        log.info("NewsWorker stopped")


async def _amain() -> None:
    await NewsWorker().start()


def main() -> None:
    asyncio.run(_amain())


if __name__ == "__main__":
    main()
