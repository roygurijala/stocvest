#!/usr/bin/env bash
# Build a single deployment zip for all stocvest-development-api-* Lambdas (Phase 6i).
# Runtime deps are installed explicitly so pytest/respx/etc. from pyproject do not push
# the unzipped bundle over Lambda's ~250 MiB limit.
# Usage: build_lambda_package.sh [output.zip]
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_INPUT="${1:-dist/lambda_api.zip}"
if [[ "${OUT_INPUT}" = /* ]]; then
  OUT="${OUT_INPUT}"
else
  OUT="${ROOT}/${OUT_INPUT}"
fi
mkdir -p "$(dirname "${OUT}")"
WORKDIR="$(mktemp -d)"
cleanup() { rm -rf "${WORKDIR}"; }
trap cleanup EXIT

RUNTIME_PKGS=(
  "redis>=5.0"
  "httpx>=0.27"
  "websockets>=12.0"
  "pandas>=2.2"
  "numpy>=1.26,<2"
  "boto3>=1.34"
  "python-dotenv>=1.0"
  "pydantic>=2.6"
  "anyio>=4.3"
  "PyJWT>=2.8"
  "pydantic-settings>=2.2"
)

python -m pip install "${RUNTIME_PKGS[@]}" -t "${WORKDIR}/pkg" --no-cache-dir --upgrade
python -m pip install "${ROOT}" --no-deps -t "${WORKDIR}/pkg" --no-cache-dir --upgrade
printf '%s\n' 'from stocvest.api.lambda_dispatch import lambda_handler' > "${WORKDIR}/pkg/handler.py"
( cd "${WORKDIR}/pkg" && zip -qr "${OUT}" . )
echo "Wrote ${OUT}"
