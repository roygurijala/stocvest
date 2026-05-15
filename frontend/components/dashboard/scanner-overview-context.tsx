"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode
} from "react";
import type { ScannerOverview } from "@/lib/api/scanner";

type ScannerOverviewContextValue = {
  overview: ScannerOverview;
  replaceOverview: (next: ScannerOverview) => void;
};

const ScannerOverviewContext = createContext<ScannerOverviewContextValue | null>(null);

export function ScannerOverviewProvider({
  initialOverview,
  children
}: {
  initialOverview: ScannerOverview;
  children: ReactNode;
}) {
  const [overview, setOverview] = useState<ScannerOverview>(initialOverview);
  const replaceOverview = useCallback((next: ScannerOverview) => {
    setOverview(next);
  }, []);
  const value = useMemo(
    () => ({
      overview,
      replaceOverview
    }),
    [overview, replaceOverview]
  );
  return <ScannerOverviewContext.Provider value={value}>{children}</ScannerOverviewContext.Provider>;
}

export function useScannerOverview(): ScannerOverview {
  const ctx = useContext(ScannerOverviewContext);
  if (!ctx) {
    throw new Error("useScannerOverview must be used within ScannerOverviewProvider");
  }
  return ctx.overview;
}

export function useReplaceScannerOverview(): (next: ScannerOverview) => void {
  const ctx = useContext(ScannerOverviewContext);
  if (!ctx) {
    throw new Error("useReplaceScannerOverview must be used within ScannerOverviewProvider");
  }
  return ctx.replaceOverview;
}
