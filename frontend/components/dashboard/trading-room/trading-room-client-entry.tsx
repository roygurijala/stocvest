"use client";

import { Suspense, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import {
  DashboardTradingRoom,
  type DashboardTradingRoomProps
} from "@/components/dashboard/trading-room/dashboard-trading-room";
import { isFirstVisitOfTradingDay } from "@/lib/dashboard/trading-room/session-selection";
import {
  peekTradingRoomOpenIntent,
  resolveTradingRoomOpenIntent
} from "@/lib/nav/dashboard-trading-room-deeplink";

function TradingRoomKeyed(props: DashboardTradingRoomProps) {
  const searchParams = useSearchParams();
  const openIntent = useMemo(() => {
    // Scanner handoff (fresh sessionStorage intent) always wins.
    if (peekTradingRoomOpenIntent()) {
      return resolveTradingRoomOpenIntent(searchParams);
    }
    // First dashboard open of a new NY day → Market Brief, not a bookmarked ?symbol=.
    if (isFirstVisitOfTradingDay()) return null;
    return resolveTradingRoomOpenIntent(searchParams);
  }, [searchParams]);

  return <DashboardTradingRoom openIntent={openIntent} {...props} />;
}

export function TradingRoomClientEntry(props: DashboardTradingRoomProps) {
  return (
    <Suspense fallback={null}>
      <TradingRoomKeyed {...props} />
    </Suspense>
  );
}
