# Deployment notes

**Last updated:** 2026-05-03 · See also [`docs/CONTEXT.md`](./CONTEXT.md) §3 (full deploy checklist).

## AWS SES (email alerts)

Before alerts work in production:

1. Verify domain `stocvest.app` in AWS SES Console → **Verified identities**.
2. Verify sender `signals@stocvest.app` (or the address set in `STOCVEST_EMAIL_SENDER`).
3. Request **SES production access** if the account is still in sandbox. In sandbox mode, SES only delivers to verified recipient addresses.
4. Set Lambda (and local) env var `STOCVEST_EMAIL_SENDER=signals@stocvest.app` (see `infra/lambda_6e.tf` `local.lambda_common_env`).

SES sandbox: emails only go to verified addresses. Open an AWS Support case to move SES out of sandbox before real users receive alerts.

Optional: set `STOCVEST_PUBLIC_APP_URL` to the canonical app URL used in alert footers (defaults to `https://stocvest.app`).
