/**
 * Next.js App Router convention: `loading.tsx` is the route-
 * transition fallback. Next renders this file while the
 * neighbouring `page.tsx` is executing on the server.
 *
 * Tier 1.B (see `docs/PERFORMANCE.md` §1 layer 3 + §4) — paired
 * with the `<Suspense fallback={<SignalsPageShell />}>` boundary
 * inside `page.tsx`. Together they cover both load windows:
 *
 *   * `loading.tsx` (this file) — covers the **inter-route**
 *     transition. When a user clicks a `<Link>` on `/dashboard`
 *     pointing at `/dashboard/signals?symbol=AAPL`, Next swaps to
 *     this file the instant the click registers, even before the
 *     server starts rendering. Pre-Tier-1.B the previous page's
 *     UI stayed frozen until `page.tsx` finished awaiting its
 *     data — a confusing UX for a slow target.
 *
 *   * `<Suspense fallback>` inside `page.tsx` — covers the
 *     **intra-render** wait. Once `page.tsx` starts streaming,
 *     the shell from `SignalsPageShell` lives in the actual page
 *     output until the data island resolves.
 *
 * Both surfaces render `<SignalsPageShell />` so the visual
 * experience is identical across both load windows.
 *
 * Do NOT add data fetches here. The whole point of this file is
 * to render without awaiting anything.
 */

import { SignalsPageShell } from "@/components/signals-page-shell";

export default function Loading() {
  return <SignalsPageShell />;
}
