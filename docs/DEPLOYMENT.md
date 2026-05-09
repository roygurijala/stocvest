# Deployment notes

**Last updated:** 2026-05-08 · See also [`docs/CONTEXT.md`](./CONTEXT.md) §3 (full deploy checklist).

**Terraform (2026-05):** Apply `infra/` so **`AuditEvents`** exists and Lambdas receive **`DYNAMODB_AUDIT_EVENTS_TABLE`** (otherwise audit falls back to in-memory per cold start). API Gateway needs the **`GET /v1/signals/founding-members`** and admin **beta** / **audit** routes for production parity with repo (`apigateway_6e.tf`).

## Vercel (frontend)

`frontend/vercel.json` sets baseline **security headers** (frame protection, MIME sniffing, referrer policy, etc.) and **HSTS** on the primary production host **`stocvest.app`**. Adjust there if counsel or security review requires stricter CSP.

## AWS SES (email alerts)

Before alerts work in production:

1. Verify domain `stocvest.app` in AWS SES Console → **Verified identities**.
2. Verify sender `signals@stocvest.app` (or the address set in `STOCVEST_EMAIL_SENDER`).
3. Request **SES production access** if the account is still in sandbox. In sandbox mode, SES only delivers to verified recipient addresses.
4. Set Lambda (and local) env var `STOCVEST_EMAIL_SENDER=signals@stocvest.app` (see `infra/lambda_6e.tf` `local.lambda_common_env`).

SES sandbox: emails only go to verified addresses. Open an AWS Support case to move SES out of sandbox before real users receive alerts.

Optional: set `STOCVEST_PUBLIC_APP_URL` to the canonical app URL used in alert footers (defaults to `https://stocvest.app`).
