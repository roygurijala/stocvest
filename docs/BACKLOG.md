# STOCVEST — Backlog

**Use with [`CONTEXT.md`](./CONTEXT.md).**  
`CONTEXT.md` holds **status-at-a-glance**, **what’s implemented**, **near-term ops** (Terraform, secrets, CI, legal), **legal rules**, and **session rules**.  
**This file** holds **planned work only**: themes, sub-items, and notes—**without** repeating the CONTEXT status table or §3 pending list.

**Last updated:** 2026-05-02

---

## Conventions

- **Done** items live in git + `CONTEXT.md` §1–§2; they are **not** re-listed here unless needed as dependency context.
- Update this file when you **add**, **reprioritize**, or **finish** a backlog theme.
- IDs (B1, P3, …) are stable handles for PRs/commits; not sprints.
- **`CONTEXT.md` §13** defines end-of-session steps: completed rows → status **DONE** plus `Done YYYY-MM-DD · commit: <hash>`; in-progress → **In progress**; **never delete a row**.

---

## Near-term operations

Tracked in **`CONTEXT.md` §3** only (Terraform apply, GitHub/AWS/Vercel secrets, broker production runtime, CI tweaks, attorney review). **Do not duplicate §3 here.**

---

## B — Product / UX

| ID | Theme | Status | Notes |
|----|--------|--------|--------|
| B1 | **Journal automation** | Not done | On fill (all adapters): create entry with symbol, side, qty, fill price, time, broker, day-trade flag, optional `signal_id` / context from order flow. Exit updates when position flat; link to signal when user acted from scanner/signals UI. |
| B2 | **Onboarding** | Not done | Wizard: value prop, broker connect, first-signal walkthrough, empty states. **Mandatory** legal acknowledgment (separate from generic ToS view) before trading features. |
| B3 | **Alerts delivery** | Not done | `Alerts` table exists; implement channels: email, push (later), SMS for critical PDT, webhooks for power users; tie to scanner/signal triggers. |
| B4 | **Watchlists** | Not done | CRUD named lists; scanner + briefing inputs use user watchlist instead of hardcoded symbols where applicable; wire existing Dynamo watchlist contract. |
| B5 | **Subscriptions** | Not done | Stripe (Atlas-linked), tier gating (Free / Pro / Institutional), usage limits; **after** attorney-reviewed ToS and entity readiness (`CONTEXT.md` §14). |
| B6 | **Sector & market internals** | Not done | Sector rotation view, breadth (A/D, highs/lows), VIX regime, optional put/call—**data-only** copy per legal framing. |
| B7 | **Risk management UX** | Not done | Position sizing helper (% of portfolio), optional max daily loss guardrails, concentration / correlation hints—**never** framed as advice; copy reviewed with counsel. |
| B8 | **Scanner order placeholder** | Not done | Replace “Order modal placeholder” on scanner with real order entry or deep-link to portfolio panel; align with Step 8 validation flow. |

---

## D — Data, performance & moat

| ID | Theme | Status | Notes |
|----|--------|--------|--------|
| D1 | **Signal outcome pipeline** | Partial | Public recent/summary exist; extend: write on signal creation, scheduled resolution (e.g. 1h/1d/1w), align fields with compliance naming; keep directional metrics separate from user P&L. |
| D2 | **Backtesting** | Not done | Historical Polygon bars; per-setup and per-regime stats; no promise of future performance in UI. |
| D3 | **Weight / prompt iteration** | Not done | Optional: weekly analytics, suggested layer weight or prompt changes, **human approve** before apply; store `prompt_version` on generations; move prompts toward Secrets Manager (`CONTEXT.md` already flags this under platform). |
| D4 | **Audit trail** | Not done | Immutable order/PDT/admin logs to durable storage (e.g. S3 Glacier-class); retention policy to align with counsel. |
| D5 | **Anonymized behavioral data policy** | Not done | Operationalize user deletion → anonymize behavioral rows; document in Privacy; engineering checklist only—**no** duplicate of legal disclaimers in `CONTEXT.md` §4. |

---

## P — Platform & quality

| ID | Theme | Status | Notes |
|----|--------|--------|--------|
| P1 | **Phase 7 hardening** | Not done | E2E suite; security review (tenant isolation, PII); load tests; **minimum 2 weeks paper** per trading mode; staged real-money rollout. |
| P2 | **Secrets-managed prompts** | Not done | Claude system/user prompts loaded from AWS Secrets Manager; version field on API calls; cache on cold start. |
| P3 | **Mobile / PWA** | Not done | Responsive web exists; native or PWA shell, push for alerts when B3 exists. |
| P4 | **Enhanced auth** | Not done | Optional SMS OTP, WebAuthn, magic link—Cognito capabilities; cost/compliance review. |

---

## G — Growth

| ID | Theme | Status | Notes |
|----|--------|--------|--------|
| G1 | **Referral program** | Not done | e.g. invite trader → credit; implement **after** Stripe/B5. |

---

## M — Multi-asset & advanced signals

| ID | Theme | Status | Notes |
|----|--------|--------|--------|
| M1 | **Cross-asset signal views** | Not done | Optional: options flow vs spot, futures basis vs spot, crypto vs risk proxies—**correlation / divergence as data**, not recommendations. |

---

## T — Post-beta “trade brief” (rich UI)

Single theme (legal review required before customer-facing price language):

- Rich card: reference levels (historical entry zone, reference targets, reference stop) as **data**, signal-parameters block, technical grid (VWAP, EMA, RSI, etc.), catalysts vs risks columns, risk/reward **chart as visualization only**.

Dependencies: D1 data maturity, counsel on display copy.

---

## Done (reference only — do not reopen)

Shipped themes are **not** backlog; see **`CONTEXT.md` §1–§2** (e.g. core signals, brokers, API, frontend redesign, order safety Step 8, legal compliance pass, earnings integration, public performance page shell, PDT enforcement, Crisp, etc.). If something regresses, file a **bug** or a **small** CONTEXT update—not a new backlog row.
