#!/usr/bin/env bash
set -euo pipefail

# Trim whitespace/newlines — a common cause of deploy-hook 400 responses.
url="$(printf '%s' "${VERCEL_DEPLOY_HOOK_URL:-}" | tr -d '\r\n' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"

if [ -z "$url" ]; then
  echo "VERCEL_DEPLOY_HOOK_URL is empty after trimming; skipping Vercel deploy."
  exit 0
fi

if ! printf '%s' "$url" | grep -Eq '^https://api\.vercel\.com/v1/integrations/deploy/[^/]+/[^/[:space:]]+$'; then
  echo "VERCEL_DEPLOY_HOOK_URL does not look like a Vercel deploy hook."
  echo "Expected: https://api.vercel.com/v1/integrations/deploy/<projectId>/<hookId>"
  echo "Create or copy a hook under Vercel → Project → Settings → Git → Deploy Hooks,"
  echo "then update the GitHub repository secret (no quotes, no curl command — URL only)."
  exit 1
fi

echo "Triggering Vercel production deploy…"
response_file="$(mktemp)"
http_code="$(
  curl -sS -o "$response_file" -w '%{http_code}' -X POST "$url"
)"

if [ "$http_code" -ge 200 ] && [ "$http_code" -lt 300 ]; then
  echo "Vercel deploy hook accepted (HTTP ${http_code})."
  cat "$response_file"
  rm -f "$response_file"
  exit 0
fi

echo "Vercel deploy hook failed (HTTP ${http_code})."
if [ -s "$response_file" ]; then
  echo "Response body:"
  cat "$response_file"
  echo
fi
rm -f "$response_file"
echo "If the hook was deleted or rotated in Vercel, create a new Deploy Hook for the production"
echo "branch and update the VERCEL_DEPLOY_HOOK_URL GitHub secret with the new URL."
exit 1
