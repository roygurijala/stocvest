"use client";

/**
 * Global SWR provider for the STOCVEST app.
 *
 * Tier 1 → Layer 4 (see `docs/PERFORMANCE.md` §1 layer 4 + §4C).
 *
 * Mounted once in `app/layout.tsx`. Every `useSWR` call below this
 * provider in the tree inherits the defaults from
 * `STOCVEST_SWR_DEFAULTS`. Hooks can still override per-key
 * (e.g. a watchlist hook can opt into `revalidateOnFocus: true`
 * because the data is high-signal).
 *
 * Implementation notes:
 *
 *   * Wrapped in `"use client"` because `SWRConfig` uses React
 *     context, and `app/layout.tsx` (the call site) is a server
 *     component.
 *
 *   * Defaults come from a separate `swr/config.ts` module so
 *     tests can import them without pulling React. Lock-in tests
 *     in `tests/swr-config.test.ts` pin the defaults.
 *
 *   * The provider does NOT carry a cache provider override
 *     (i.e. we use SWR's default Map-backed cache). When we add
 *     SSR / hydration of cached data we'll likely swap to a
 *     custom `provider` that hydrates from a server payload —
 *     that's a follow-up, out of scope here.
 */

import type { ReactNode } from "react";
import { SWRConfig } from "swr";

import { STOCVEST_SWR_DEFAULTS } from "./config";
import { swrFetcher } from "./fetcher";

export function StocvestSwrProvider({ children }: { children: ReactNode }) {
  return (
    <SWRConfig
      value={{
        fetcher: swrFetcher,
        ...STOCVEST_SWR_DEFAULTS
      }}
    >
      {children}
    </SWRConfig>
  );
}
