#!/usr/bin/env bash
# Build a single deployment zip for all stocvest-development-api-* Lambdas (Phase 6i).
# Usage: build_lambda_package.sh [output.zip]
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-${ROOT}/dist/lambda_api.zip}"
mkdir -p "$(dirname "${OUT}")"
WORKDIR="$(mktemp -d)"
cleanup() { rm -rf "${WORKDIR}"; }
trap cleanup EXIT

python -m pip install "${ROOT}" -t "${WORKDIR}/pkg" --no-cache-dir --upgrade
printf '%s\n' 'from stocvest.api.lambda_dispatch import lambda_handler' > "${WORKDIR}/pkg/handler.py"
( cd "${WORKDIR}/pkg" && zip -qr "${OUT}" . )
echo "Wrote ${OUT}"
