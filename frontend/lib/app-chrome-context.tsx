"use client";

import { createContext, useContext, type ReactNode } from "react";

type AppChrome = {
  /** Opens the mobile nav drawer owned by `AppShell`. No-op when chrome is absent. */
  openNavDrawer: () => void;
};

const AppChromeContext = createContext<AppChrome>({ openNavDrawer: () => {} });

export function AppChromeProvider({
  value,
  children
}: {
  value: AppChrome;
  children: ReactNode;
}) {
  return <AppChromeContext.Provider value={value}>{children}</AppChromeContext.Provider>;
}

/**
 * Lets nested page chrome (e.g. the trading-room session header) trigger the
 * `AppShell`-owned mobile nav drawer.
 */
export function useAppChrome(): AppChrome {
  return useContext(AppChromeContext);
}
