import React from "react";
import { describe, expect, test, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { OrderStatusTracker } from "@/components/order-status-tracker";
import { ThemeProvider } from "@/lib/theme-provider";

function wrap(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

describe("OrderStatusTracker", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("shows pending state on mount", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => new Promise(() => {})) as typeof fetch
    );
    wrap(<OrderStatusTracker broker="mock" accountId="A1" clientOrderId="o1" />);
    expect(screen.getByText(/awaiting fill/i)).toBeTruthy();
  });

  test("polls until filled", async () => {
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        n += 1;
        if (n < 2) {
          return Promise.resolve(new Response(JSON.stringify({ status: "submitted" }), { status: 200 }));
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              status: "filled",
              quantity_filled: 100,
              quantity_ordered: 100,
              average_fill_price: 182.47
            }),
            { status: 200 }
          )
        );
      }) as typeof fetch
    );
    wrap(<OrderStatusTracker broker="mock" accountId="A1" clientOrderId="o1" />);
    await waitFor(
      () => {
        expect(screen.getByText(/Filled/i)).toBeTruthy();
      },
      { timeout: 4000 }
    );
    expect(screen.getByText(/\$182\.47/)).toBeTruthy();
  });

  test("maps rejection codes to plain English", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ status: "rejected", reject_reason: "PDT_VIOLATION" }), { status: 200 })
      ) as typeof fetch
    );
    wrap(<OrderStatusTracker broker="mock" accountId="A1" clientOrderId="o1" />);
    await waitFor(() => expect(screen.getByText(/PDT limit reached/i)).toBeTruthy(), { timeout: 4000 });
  });
});
