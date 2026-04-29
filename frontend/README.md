# STOCVEST Frontend (Phase 5a)

This directory contains the Phase 5 frontend foundation:

- Next.js app scaffold
- Auth/session cookie handling
- Protected dashboard route shell
- Shared API client bootstrap

## Local setup

1. Copy `.env.example` to `.env.local`
2. Install dependencies:
   - `npm install`
3. Start dev server:
   - `npm run dev`

## Current auth flow

- Login accepts a valid Cognito ID token and stores it as an HTTP-only cookie.
- Middleware protects `/dashboard`.
- Server API requests automatically forward `Authorization: Bearer <token>`.
