"use client";

import { useEffect } from "react";

export default function DashboardError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("dashboard_error_boundary", error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[50vh] max-w-lg flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="m-0 text-lg font-semibold">Dashboard failed to load</h1>
      <p className="m-0 text-sm opacity-80">
        A network or rendering error interrupted the page. This is usually temporary — try again in a
        moment.
      </p>
      <button
        type="button"
        onClick={() => reset()}
        className="rounded-full border border-current px-4 py-2 text-sm font-semibold"
      >
        Retry
      </button>
    </div>
  );
}
