"use client";

import { PerformanceTrackingContent } from "@/components/performance-tracking-content";

export default function PerformancePage() {
  return (
    <main className="min-h-screen overflow-x-hidden bg-[#0a0e1a] px-4 py-14 md:px-8">
      <div className="mx-auto max-w-7xl">
        <PerformanceTrackingContent showHomeLink />
      </div>
    </main>
  );
}
