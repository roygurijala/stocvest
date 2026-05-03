import React from "react";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { OrderConfirmationModal } from "@/components/order-confirmation-modal";
import { ThemeProvider } from "@/lib/theme-provider";
import type { OrderDraft } from "@/components/order-confirmation-modal";

const draft: OrderDraft = {
  broker: "mock",
  accountId: "A1",
  symbol: "AAPL",
  side: "buy",
  quantity: 100,
  orderType: "market",
  timeInForce: "day",
  clientOrderId: "c-test",
  availableCash: 1e6,
  isDayTrade: true
};

function wrap(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

describe("OrderConfirmationModal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/pdt/status")) {
          return new Response(JSON.stringify({ assessment: { day_trades_in_window: 2 } }), { status: 200 });
        }
        return new Response("{}", { status: 200 });
      }) as typeof fetch
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test("renders with correct order details", () => {
    wrap(
      <OrderConfirmationModal open draft={draft} tradingMode="paper" onClose={() => {}} onAccepted={() => {}} />
    );
    expect(screen.getByText(/BUY 100 shares of AAPL/i)).toBeTruthy();
    expect(screen.getByText(/Order type: market/i)).toBeTruthy();
  });

  test("confirm button disabled for first 2 seconds", () => {
    wrap(
      <OrderConfirmationModal open draft={draft} tradingMode="paper" onClose={() => {}} onAccepted={() => {}} />
    );
    const btn = screen.getByRole("button", { name: /Confirm Order/i });
    expect(btn).toBeDisabled();
    act(() => {
      vi.advanceTimersByTime(2100);
    });
    expect(btn).not.toBeDisabled();
  });

  test("shows PDT warning when trades_used >= 2", async () => {
    wrap(
      <OrderConfirmationModal open draft={draft} tradingMode="paper" onClose={() => {}} onAccepted={() => {}} />
    );
    await act(async () => {
      vi.advanceTimersByTime(50);
    });
    expect(screen.getByText(/2 of 3 day trades used/i)).toBeTruthy();
  });

  test("shows PDT block when trades_used === 3", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/pdt/status")) {
          return new Response(JSON.stringify({ assessment: { day_trades_in_window: 3 } }), { status: 200 });
        }
        return new Response("{}", { status: 200 });
      }) as typeof fetch
    );
    wrap(
      <OrderConfirmationModal open draft={draft} tradingMode="paper" onClose={() => {}} onAccepted={() => {}} />
    );
    await act(async () => {
      vi.advanceTimersByTime(50);
    });
    expect(screen.getByText(/PDT: Limit reached/i)).toBeTruthy();
    const btn = screen.getByRole("button", { name: /Confirm Order/i });
    expect(btn).toBeDisabled();
  });

  test("calls validate before submit and does not submit if validation fails", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/pdt/status")) {
        return new Response(JSON.stringify({ assessment: { day_trades_in_window: 0 } }), { status: 200 });
      }
      if (url.includes("/validate")) {
        return new Response(JSON.stringify({ is_valid: false, errors: ["bad"] }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    wrap(
      <OrderConfirmationModal open draft={draft} tradingMode="paper" onClose={() => {}} onAccepted={() => {}} />
    );
    act(() => {
      vi.advanceTimersByTime(2100);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Confirm Order$/i }));
    });
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/validate"))).toBe(true);
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/submit"))).toBe(false);
  });

  test("calls submit with confirmed path on success", async () => {
    const onAccepted = vi.fn();
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/pdt/status")) {
        return new Response(JSON.stringify({ assessment: { day_trades_in_window: 0 } }), { status: 200 });
      }
      if (url.includes("/validate")) {
        return new Response(
          JSON.stringify({
            is_valid: true,
            estimated_cost: 18250,
            current_bid: 182.4,
            current_ask: 182.52,
            spread_pct: 0.07
          }),
          { status: 200 }
        );
      }
      if (url.includes("/submit")) {
        return new Response(JSON.stringify({ client_order_id: "c-test" }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    wrap(
      <OrderConfirmationModal open draft={draft} tradingMode="paper" onClose={() => {}} onAccepted={onAccepted} />
    );
    act(() => {
      vi.advanceTimersByTime(2100);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Confirm Order$/i }));
    });
    const submitBody = fetchMock.mock.calls.find(([u]) => String(u).includes("/submit"));
    expect(submitBody).toBeTruthy();
    const init = submitBody?.[1] as RequestInit;
    expect(JSON.parse(String(init.body)).confirmed).toBe(true);
    expect(onAccepted).toHaveBeenCalledWith("c-test");
  });

  test("shows acting-on-signal callout and passes signal fields on submit", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/pdt/status")) {
        return new Response(JSON.stringify({ assessment: { day_trades_in_window: 0 } }), { status: 200 });
      }
      if (url.includes("/validate")) {
        return new Response(JSON.stringify({ is_valid: true, estimated_cost: 100 }), { status: 200 });
      }
      if (url.includes("/submit")) {
        return new Response(JSON.stringify({ client_order_id: "c-sig" }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    const draftWithSignal: OrderDraft = {
      ...draft,
      signalContext: {
        signal_id: "sig-abc",
        signal_strength: 82,
        confluence_score: 91,
        pattern: "orb_breakout_long",
        signal_direction: "bullish"
      }
    };

    wrap(
      <OrderConfirmationModal open draft={draftWithSignal} tradingMode="paper" onClose={() => {}} onAccepted={() => {}} />
    );
    expect(screen.getByText(/Acting on signal/i)).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(2100);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Confirm Order$/i }));
    });
    const submitCall = fetchMock.mock.calls.find(([u]) => String(u).includes("/submit"));
    const init = submitCall?.[1] as RequestInit;
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.confirmed).toBe(true);
    expect(body.signal_id).toBe("sig-abc");
    expect(body.signal_strength).toBe(82);
    expect(body.confluence_score).toBe(91);
    expect(body.pattern).toBe("orb_breakout_long");
    expect(body.signal_direction).toBe("bullish");
  });
});
