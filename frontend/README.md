# STOCVEST Frontend

Next.js **14** app (`app/` router): marketing **landing** (`/`), auth (`/login`, `/signup`, …), **dashboard** (scanner, signals, watchlists, portfolio, journal, settings, …), BFF routes under `/api/stocvest/**`, and static/legal pages.

**Session context & test baselines:** [`docs/CONTEXT.md`](../docs/CONTEXT.md)

## Local setup

1. Copy `.env.example` to `.env.local` (set `NEXT_PUBLIC_STOCVEST_API_BASE_URL`, Cognito IDs from Terraform outputs, etc.).
2. `npm ci` (or `npm install`)
3. `npm run dev`

## Quality gates

```bash
npm run build
npm run test
```

Exact counts for releases live in **CONTEXT.md §13**.

## Auth (summary)

- Login stores Cognito ID token as an **httpOnly** cookie (BFF verifies session).
- Middleware protects `/dashboard/**`.
- Server components and route handlers forward `Authorization: Bearer <token>` to the STOCVEST API where required.
