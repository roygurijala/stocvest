import type { RefObject } from "react";
import { act, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { WatchlistCheckNowStickyBar } from "@/components/watchlists/watchlist-check-now-sticky-bar";
import { ThemeProvider } from "@/lib/theme-provider";

let lastObserverCallback: IntersectionObserverCallback | null = null;

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined
    })
  });
  class MockIntersectionObserver {
    observe = vi.fn();
    disconnect = vi.fn();
    unobserve = vi.fn();
    constructor(callback: IntersectionObserverCallback) {
      lastObserverCallback = callback;
    }
  }
  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
});

describe("WatchlistCheckNowStickyBar", () => {
  it("does not render when count is zero", () => {
    const sentinelRef = { current: document.createElement("div") } as RefObject<HTMLElement | null>;
    render(
      <ThemeProvider>
        <WatchlistCheckNowStickyBar count={0} sentinelRef={sentinelRef} />
      </ThemeProvider>
    );
    expect(screen.queryByTestId("watchlist-check-now-sticky-bar")).not.toBeInTheDocument();
  });

  it("renders sticky bar when sentinel leaves viewport", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const sentinelRef = { current: el } as RefObject<HTMLElement | null>;

    render(
      <ThemeProvider>
        <WatchlistCheckNowStickyBar count={2} sentinelRef={sentinelRef} />
      </ThemeProvider>
    );

    act(() => {
      lastObserverCallback?.(
        [{ isIntersecting: false, target: el } as IntersectionObserverEntry],
        {} as IntersectionObserver
      );
    });

    expect(screen.getByTestId("watchlist-check-now-sticky-bar")).toHaveTextContent("Check now (2)");
    el.remove();
  });
});
