"use client";

import Link from "next/link";
import type { ComponentPropsWithoutRef, CSSProperties, ReactNode } from "react";
import type { FeedLane } from "@/lib/dashboard/trading-room/feed-model";
import { dashboardTradingRoomHref } from "@/lib/nav/dashboard-trading-room-deeplink";

type Props = {
  symbol: string;
  company?: string | null;
  lane?: FeedLane;
  onSelect: (symbol: string, company?: string | null, lane?: FeedLane) => void;
  "data-testid"?: string;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
} & Omit<ComponentPropsWithoutRef<typeof Link>, "href" | "children" | "onClick" | "style" | "className" | "onSelect">;

/** In-panel symbol navigation for Market Brief — Link href for fallback, click opens Deep Dive. */
export function MarketBriefSymbolLink({
  symbol,
  company,
  lane = "swing",
  onSelect,
  "data-testid": dataTestId,
  className,
  style,
  children,
  ...linkProps
}: Props) {
  const sym = symbol.trim().toUpperCase();
  const laneNorm: FeedLane = lane === "day" ? "day" : "swing";
  return (
    <Link
      href={dashboardTradingRoomHref(sym, laneNorm)}
      prefetch={false}
      data-testid={dataTestId}
      className={className}
      style={{ textDecoration: "none", color: "inherit", ...style }}
      onClick={(e) => {
        e.preventDefault();
        onSelect(sym, company, laneNorm);
      }}
      {...linkProps}
    >
      {children}
    </Link>
  );
}
