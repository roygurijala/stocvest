# STOCVEST Frontend

Next.js **14** app (`app/` router): marketing **landing** (`/`) — server load combines recent signals, performance summary, and **`GET /v1/signals/founding-members`** (`lib/api/founding-members.ts`) for the first-**100** founding offer strip; **`components/landing-page.tsx`** owns the hero, mode comparison, engine **SWING/DAY** tabs, workflows, FAQ-style transparency, and pricing; auth (`/login`, `/signup`, …), **dashboard** (scanner, signals, watchlists, broker **portfolio**, signal **validation** ledger, journal, settings, …), BFF routes under `/api/stocvest/**` (including **`/api/stocvest/signals/swing-composite`**, **`/api/stocvest/signals/me/history`**, **`/api/stocvest/signals/me/records/[signalId]`**, **`/api/stocvest/portfolio/**`** for linked brokers, journal, users, watchlists, alerts), and static/legal pages. **`vercel.json`** configures production security headers. Landing tests: **`tests/landing-page.test.tsx`**.

**Session context & test baselines:** [`docs/CONTEXT.md`](../docs/CONTEXT.md) §13.

**Dashboard copy:** circled‑i **InfoTip** text for the home dashboard (including empty **Top signals** / **Primary read**) lives in **`lib/ui-tooltips.ts`**; keep new tips in plain language for non-experts. Tooltip bodies support multiple paragraphs via **`white-space: pre-line`** in **`components/info-tip.tsx`**.

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
