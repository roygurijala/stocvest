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

print_git_source_help() {
  echo "Vercel could not resolve the Git branch/commit for this deploy hook"
  echo "(incorrect_git_source_info). This is a Vercel ↔ GitHub integration issue, not a"
  echo "frontend build failure. Fix in the Vercel dashboard:"
  echo "  1. Project → Settings → Git — confirm roygurijala/stocvest is connected."
  echo "  2. Reconnect GitHub if needed (Authentication → Git in Vercel account settings)."
  echo "  3. Settings → Git → Deploy Hooks — delete the old hook, create a new one for branch"
  echo "     main (production), copy the URL only into GitHub secret VERCEL_DEPLOY_HOOK_URL."
  echo "  4. Confirm main exists on GitHub and the Vercel GitHub App has repo access."
}

attempt=1
max_attempts="${VERCEL_DEPLOY_HOOK_RETRIES:-3}"
retry_delay="${VERCEL_DEPLOY_HOOK_RETRY_DELAY_SEC:-20}"

if [ -n "${GITHUB_SHA:-}" ]; then
  echo "GitHub commit: ${GITHUB_SHA} (${GITHUB_REF:-unknown ref})"
fi

while [ "$attempt" -le "$max_attempts" ]; do
  echo "Triggering Vercel production deploy (attempt ${attempt}/${max_attempts})…"
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

  body=""
  if [ -s "$response_file" ]; then
    body="$(cat "$response_file")"
  fi
  rm -f "$response_file"

  echo "Vercel deploy hook failed (HTTP ${http_code})."
  if [ -n "$body" ]; then
    echo "Response body:"
    printf '%s\n' "$body"
    echo
  fi

  if printf '%s' "$body" | grep -q 'incorrect_git_source_info'; then
    print_git_source_help
    exit 1
  fi

  if [ "$attempt" -lt "$max_attempts" ] && printf '%s' "$http_code" | grep -Eq '^(400|429|502|503)$'; then
    echo "Retrying in ${retry_delay}s…"
    sleep "$retry_delay"
    attempt=$((attempt + 1))
    continue
  fi

  echo "If the hook was deleted or rotated in Vercel, create a new Deploy Hook for the production"
  echo "branch and update the VERCEL_DEPLOY_HOOK_URL GitHub secret with the new URL."
  exit 1
done
