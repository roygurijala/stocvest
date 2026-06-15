import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { SessionMoverContext } from "@/components/dashboard/trading-room/session-mover-context";
import type { FeedCard } from "@/lib/dashboard/trading-room/feed-model";
import { ThemeProvider } from "@/lib/theme-provider";

const moverCard: FeedCard = {
  id: "day:UBXG",
  symbol: "UBXG",
  company: null,
  lane: "day",
  state: "potential",
  bias: "bull",
  verdict: "Session mover · not an entry",
  phase: "session activity",
  price: 9.44,
  changePct: 27.4,
  alignment: null,
  rankScore: 88,
  source: "desk",
  setupTier: "mover"
};

describe("SessionMoverContext", () => {
  test("renders mover context without desk gate language", () => {
    render(
      <ThemeProvider>
        <SessionMoverContext
          card={moverCard}
          company="U-BX Technology Ltd."
          price={9.44}
          changePct={27.4}
          colors={{
            surface: "#111",
            surfaceMuted: "#1a1a1a",
            border: "#333",
            text: "#eee",
            textMuted: "#999",
            caution: "#f59e0b",
            bullish: "#22c55e",
            bearish: "#ef4444",
            accent: "#3b82f6",
            background: "#000"
          } as never}
        />
      </ThemeProvider>
    );
    expect(screen.getByTestId("session-mover-context")).toBeInTheDocument();
    expect(screen.getByText("Session mover")).toBeInTheDocument();
    expect(screen.getByText("U-BX Technology Ltd.")).toBeInTheDocument();
    expect(screen.getByText(/not an entry/i)).toBeInTheDocument();
    expect(screen.queryByText(/Clears gate/i)).toBeNull();
  });
});
