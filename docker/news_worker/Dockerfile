# STOCVEST Fargate news worker: Benzinga WebSocket + SEC EDGAR 8-K → SQS
FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml /app/
COPY stocvest /app/stocvest

RUN pip install --no-cache-dir pip setuptools wheel \
    && pip install --no-cache-dir .

ENV PYTHONUNBUFFERED=1

CMD ["python", "-m", "stocvest.workers.news_worker"]
