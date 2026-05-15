"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode
} from "react";
import type { EarningsEvent } from "@/lib/api/earnings";

export type DashboardEarningsSlice = {
  upcoming: EarningsEvent[];
  recent: EarningsEvent[];
};

type DashboardEarningsContextValue = {
  slice: DashboardEarningsSlice;
  replaceEarnings: (next: DashboardEarningsSlice) => void;
};

const DashboardEarningsContext = createContext<DashboardEarningsContextValue | null>(null);

export function DashboardEarningsProvider({
  initialUpcoming,
  initialRecent,
  children
}: {
  initialUpcoming: EarningsEvent[];
  initialRecent: EarningsEvent[];
  children: ReactNode;
}) {
  const [slice, setSlice] = useState<DashboardEarningsSlice>({
    upcoming: initialUpcoming,
    recent: initialRecent
  });
  const replaceEarnings = useCallback((next: DashboardEarningsSlice) => {
    setSlice(next);
  }, []);
  const value = useMemo(
    () => ({
      slice,
      replaceEarnings
    }),
    [slice, replaceEarnings]
  );
  return <DashboardEarningsContext.Provider value={value}>{children}</DashboardEarningsContext.Provider>;
}

export function useDashboardEarnings(): DashboardEarningsSlice {
  const ctx = useContext(DashboardEarningsContext);
  if (!ctx) {
    throw new Error("useDashboardEarnings must be used within DashboardEarningsProvider");
  }
  return ctx.slice;
}

export function useReplaceDashboardEarnings(): (next: DashboardEarningsSlice) => void {
  const ctx = useContext(DashboardEarningsContext);
  if (!ctx) {
    throw new Error("useReplaceDashboardEarnings must be used within DashboardEarningsProvider");
  }
  return ctx.replaceEarnings;
}
