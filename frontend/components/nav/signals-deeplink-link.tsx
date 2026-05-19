"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import {
  contextualSignalsHref,
  type SignalsContextRef
} from "@/lib/nav/watchlist-signals-deeplink";

type Props = Omit<ComponentProps<typeof Link>, "href" | "prefetch"> & {
  symbol: string;
  contextRef: SignalsContextRef;
  tradingMode?: "day" | "swing";
};

/**
 * Deep-link into Signals without Next.js viewport prefetch (`_rsc=…` flight).
 * Those prefetches load the page shell only — not composite/maturation API data.
 */
export function SignalsDeeplinkLink({ symbol, contextRef, tradingMode, ...rest }: Props) {
  return (
    <Link
      href={contextualSignalsHref(symbol, contextRef, tradingMode)}
      prefetch={false}
      {...rest}
    />
  );
}
