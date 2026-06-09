"use client";

import { Suspense, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import {
  DashboardTradingRoom,
  type DashboardTradingRoomProps
} from "@/components/dashboard/trading-room/dashboard-trading-room";
import { resolveTradingRoomOpenIntent } from "@/lib/nav/dashboard-trading-room-deeplink";

function TradingRoomKeyed(props: DashboardTradingRoomProps) {
  const searchParams = useSearchParams();
  const openIntent = useMemo(() => resolveTradingRoomOpenIntent(searchParams), [searchParams]);

  return <DashboardTradingRoom openIntent={openIntent} {...props} />;
}

export function TradingRoomClientEntry(props: DashboardTradingRoomProps) {
  return (
    <Suspense fallback={null}>
      <TradingRoomKeyed {...props} />
    </Suspense>
  );
}
