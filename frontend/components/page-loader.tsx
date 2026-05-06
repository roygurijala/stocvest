"use client";

import { CuteLoader } from "@/components/cute-loader";

export function PageLoader() {
  return (
    <div
      className="fixed inset-0 z-[120] grid place-items-center"
      style={{
        background:
          "radial-gradient(circle at 50% 42%, rgba(17,24,39,0.32) 0%, rgba(10,14,26,0.86) 54%, rgba(10,14,26,0.92) 100%)"
      }}
    >
      <CuteLoader label="Loading page" sublabel="Just a sec, getting things ready" />
    </div>
  );
}
