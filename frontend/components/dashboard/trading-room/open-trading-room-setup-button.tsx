"use client";

import type { CSSProperties, ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { FeedLane } from "@/lib/dashboard/trading-room/feed-model";
import {
  dashboardTradingRoomHref,
  stashTradingRoomOpenIntent
} from "@/lib/nav/dashboard-trading-room-deeplink";

type Props = {
  symbol: string;
  lane?: FeedLane;
  children: ReactNode;
  style?: CSSProperties;
};

/** Scanner → dashboard handoff: stash intent then navigate (more reliable than Link alone). */
export function OpenTradingRoomSetupButton({ symbol, lane = "swing", children, style }: Props) {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => {
        stashTradingRoomOpenIntent(symbol, lane);
        router.push(dashboardTradingRoomHref(symbol, lane));
      }}
      style={{
        border: "none",
        cursor: "pointer",
        ...style
      }}
    >
      {children}
    </button>
  );
}
