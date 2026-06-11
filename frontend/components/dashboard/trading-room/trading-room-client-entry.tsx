"use client";

import { Suspense, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import {
  DashboardTradingRoom,
  type DashboardTradingRoomProps
} from "@/components/dashboard/trading-room/dashboard-trading-room";
import { peekTradingRoomOpenIntent } from "@/lib/nav/dashboard-trading-room-deeplink";

function TradingRoomKeyed(props: DashboardTradingRoomProps) {
  useSearchParams();
  const openIntent = useMemo(
    () => peekTradingRoomOpenIntent(),
    // Handoff lives in sessionStorage; re-read once per document load.
    []
  );

  return <DashboardTradingRoom openIntent={openIntent} {...props} />;
}

export function TradingRoomClientEntry(props: DashboardTradingRoomProps) {
  return (
    <Suspense fallback={null}>
      <TradingRoomKeyed {...props} />
    </Suspense>
  );
}
