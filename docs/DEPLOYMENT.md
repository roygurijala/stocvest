# Deployment notes

**Last updated:** 2026-05-22 · See also [`docs/CONTEXT.md`](./CONTEXT.md) §3 (full deploy checklist).

**Validation ledger capture (B62, 2026-05-22):** Requires **`terraform apply`** to create EventBridge schedule **`stocvest-development-scanner-ledger-capture`** (`scan_type: ledger_capture`, **3:55 PM ET** Mon–Fri). Push to **`main`** runs CI **`deploy-lambda`**, which must update **`scanner`** (schedule handler) and **`signals`** (composite engines + gate persistence). No new secrets or Dynamo tables.

**Signal intelligence (B58–B61, 2026-05-21):** No Terraform change. Push to **`main`** runs GitHub Actions **`deploy-lambda`**, which updates **`signals`** (composite: `causal_narrative`, day `timeframe_alignment`) and **`brokers`** (watchlist maturation-summary `progress_band` / `near_ready_*`) function code. Frontend ships via **`deploy-vercel`** when the hook is configured.

**Terraform (2026-05):** Apply `infra/` so **`AuditEvents`** exists and Lambdas receive **`DYNAMODB_AUDIT_EVENTS_TABLE`** (otherwise audit falls back to in-memory per cold start). API Gateway needs the **`GET /v1/signals/founding-members`** and admin **beta** / **audit** / **`GET /v1/admin/users/{user_id}/activity-errors`** routes for production parity with repo (`apigateway_6e.tf`).

## Vercel (frontend)

`frontend/vercel.json` sets baseline **security headers** (frame protection, MIME sniffing, referrer policy, etc.) and **HSTS** on the primary production host **`stocvest.ai`**. **`stocvest.app`** redirects to **`.ai`**. Adjust there if counsel or security review requires stricter CSP.

## AWS SES (email alerts)

Before alerts work in production:

1. Verify domain **`stocvest.ai`** in AWS SES Console → **Verified identities** (add DKIM/SPF records SES provides).
2. Sender is **`signals@stocvest.ai`** (set in `STOCVEST_EMAIL_SENDER`; no separate identity needed once the domain is verified).
3. Request **SES production access** if the account is still in sandbox. In sandbox mode, SES only delivers to verified recipient addresses.
4. Lambda env is set in `infra/lambda_6e.tf` (`STOCVEST_EMAIL_SENDER=signals@stocvest.ai`). Redeploy after `terraform apply`.

SES sandbox: emails only go to verified addresses. Open an AWS Support case to move SES out of sandbox before real users receive alerts.

`STOCVEST_PUBLIC_APP_URL` defaults to **`https://stocvest.ai`** (links in alert footers).
