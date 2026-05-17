"use client";

import { ContentLoading } from "@/components/content-loading";
import { useTheme } from "@/lib/theme-provider";

/** Full-screen overlay during in-app route transitions (AppShell). */
export function PageLoader() {
  const { theme } = useTheme();
  const scrim =
    theme === "dark"
      ? "radial-gradient(circle at 50% 42%, rgba(30,41,59,0.38) 0%, rgba(10,14,26,0.88) 52%, rgba(10,14,26,0.94) 100%)"
      : "radial-gradient(circle at 50% 42%, rgba(255,255,255,0.5) 0%, rgba(248,250,252,0.9) 52%, rgba(248,250,252,0.96) 100%)";

  return (
    <div
      className="pointer-events-none fixed inset-0 z-[120] grid place-items-center"
      style={{ background: scrim }}
    >
      <div className="pointer-events-auto">
        <ContentLoading />
      </div>
    </div>
  );
}
