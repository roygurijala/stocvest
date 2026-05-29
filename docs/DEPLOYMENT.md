# Deployment notes

**Last updated:** 2026-05-22 · See also [`docs/CONTEXT.md`](./CONTEXT.md) §3 (full deploy checklist).

**Validation ledger capture (B62, 2026-05-22):** Requires **`terraform apply`** to create EventBridge schedule **`stocvest-development-scanner-ledger-capture`** (`scan_type: ledger_capture`, **3:55 PM ET** Mon–Fri). Push to **`main`** runs CI **`deploy-lambda`**, which must update **`scanner`** (schedule handler) and **`signals`** (composite engines + gate persistence). No new secrets or Dynamo tables.

**Signal intelligence (B58–B61, 2026-05-21):** No Terraform change. Push to **`main`** runs GitHub Actions **`deploy-lambda`**, which updates **`signals`** (composite: `causal_narrative`, day `timeframe_alignment`) and **`brokers`** (watchlist maturation-summary `progress_band` / `near_ready_*`) function code. Frontend ships via **`deploy-vercel`** when the hook is configured.

**Terraform (2026-05):** Apply `infra/` so **`AuditEvents`** exists and Lambdas receive **`DYNAMODB_AUDIT_EVENTS_TABLE`** (otherwise audit falls back to in-memory per cold start). API Gateway needs the **`GET /v1/signals/founding-members`** and admin **beta** / **audit** / **`GET /v1/admin/users/{user_id}/activity-errors`** routes for production parity with repo (`apigateway_6e.tf`).

## Vercel (frontend)

`frontend/vercel.json` sets baseline **security headers** (frame protection, MIME sniffing, referrer policy, etc.) and **HSTS** on the primary production host **`stocvest.ai`**. **`stocvest.app`** redirects to **`.ai`**. Adjust there if counsel or security review requires stricter CSP.

## Postmark (transactional email — alerts + trial reminders)

Production email uses **Postmark**, not AWS SES. Alert and trial flows call `stocvest/services/email_service.py` → Postmark **`POST /email`**.

### One-time setup

1. In [Postmark](https://account.postmarkapp.com/), create a **Server** for STOCVEST (transactional).
2. **Verify sender domain** `stocvest.ai`:
   - Add the DKIM + Return-Path DNS records Postmark provides.
   - Confirm the default **From** address matches Lambda env: **`signals@stocvest.ai`** (`STOCVEST_EMAIL_SENDER` in `infra/lambda_6e.tf`).
3. Copy the **Server API token** (not the Account token).
4. Store the token in AWS Secrets Manager secret **`stocvest/external-api-keys`**:

   ```json
   {
     "POSTMARK_SERVER_TOKEN": "your-server-token-here"
   }
   ```

   Lambda loads this via `stocvest/utils/config.py` (`get_settings()`). For local dev, set `POSTMARK_SERVER_TOKEN` in `.env` (see `.env.example`).

5. **Upgrade your Postmark plan** before production traffic — the free developer tier is for testing (low monthly send cap). Your account must be **approved** to send to arbitrary recipients.

6. Redeploy Lambda after updating the secret (`deploy-lambda` on `main`). No SES IAM permission is required.

### Smoke test

- Postmark UI → **Send test email** from the server, or trigger a watchlist maturation / alert path in staging.
- Check **Activity** in Postmark for bounces and spam complaints.

`STOCVEST_PUBLIC_APP_URL` defaults to **`https://stocvest.ai`** (links in alert footers).

### Legacy note

Earlier docs referenced **AWS SES**. SES is no longer used for outbound mail; remove any unused SES verified identities from AWS if you are not using them elsewhere.
