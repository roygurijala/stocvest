import { describe, expect, it, vi } from "vitest";

import { focusWatchlistRow, watchlistRowElementId, WATCHLIST_ROW_HIGHLIGHT_MS } from "@/lib/watchlist-row-focus";

describe("watchlistRowElementId", () => {
  it("normalizes symbol to uppercase row id", () => {
    expect(watchlistRowElementId("aapl")).toBe("watchlist-row-AAPL");
  });
});

describe("focusWatchlistRow", () => {
  it("scrolls and highlights when the row exists", async () => {
    vi.useFakeTimers();
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 0;
    });
    const el = document.createElement("li");
    el.id = "watchlist-row-NVDA";
    document.body.appendChild(el);
    const scrollIntoView = vi.fn();
    el.scrollIntoView = scrollIntoView;

    expect(focusWatchlistRow("nvda", "#38bdf8")).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "smooth" });
    expect(el.classList.contains("watchlist-row-highlight")).toBe(true);
    expect(el.style.getPropertyValue("--watchlist-highlight-color")).toBe("#38bdf8");

    vi.advanceTimersByTime(WATCHLIST_ROW_HIGHLIGHT_MS);
    expect(el.classList.contains("watchlist-row-highlight")).toBe(false);

    el.remove();
    raf.mockRestore();
    vi.useRealTimers();
  });

  it("returns false when row is missing", () => {
    expect(focusWatchlistRow("MISSING", "#38bdf8")).toBe(false);
  });
});
