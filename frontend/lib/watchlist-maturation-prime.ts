/**
 * Prime watchlist maturation by running the same composite path as Signals Evidence
 * (persists WatchlistMaturation via backend sync on compute/cache hit).
 */

export async function primeWatchlistSymbolMaturation(
  symbol: string,
  dualDesk: boolean
): Promise<void> {
  const sym = symbol.trim().toUpperCase();
  if (!sym) return;
  const modes = dualDesk ? (["swing", "day"] as const) : (["swing"] as const);
  await Promise.allSettled(
    modes.map((mode) =>
      fetch(
        mode === "swing"
          ? "/api/stocvest/signals/composite/swing"
          : "/api/stocvest/signals/composite/real",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ symbol: sym })
        }
      )
    )
  );
}
