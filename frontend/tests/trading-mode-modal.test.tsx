import React from "react";
import { describe, expect, test, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TradingModeModal } from "@/components/trading-mode-modal";
import { ThemeProvider } from "@/lib/theme-provider";

function wrap(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

describe("TradingModeModal", () => {
  test("switching to paper requires no confirmation phrase", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ trading_mode: "paper" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock as typeof fetch);
    const onModeChange = vi.fn();
    wrap(
      <TradingModeModal open initialMode="live" onClose={() => {}} onModeChange={onModeChange} />
    );
    fireEvent.click(screen.getByRole("button", { name: /Switch to Paper/i }));
    await waitFor(() => expect(onModeChange).toHaveBeenCalledWith("paper"));
    vi.unstubAllGlobals();
  });

  test("cannot switch to live without typing exact phrase", () => {
    wrap(
      <TradingModeModal open initialMode="paper" onClose={() => {}} onModeChange={() => {}} />
    );
    fireEvent.click(screen.getByRole("button", { name: /Switch to Live/i }));
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    const confirmBtn = screen.getByRole("button", { name: /Enable live trading/i });
    expect(confirmBtn).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("CONFIRM LIVE TRADING"), { target: { value: "wrong" } });
    expect(confirmBtn).toBeDisabled();
  });

  test("confirm enables only after exact phrase", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ trading_mode: "live" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock as typeof fetch);
    const onModeChange = vi.fn();
    wrap(
      <TradingModeModal open initialMode="paper" onClose={() => {}} onModeChange={onModeChange} />
    );
    fireEvent.click(screen.getByRole("button", { name: /Switch to Live/i }));
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    const input = screen.getByPlaceholderText("CONFIRM LIVE TRADING");
    fireEvent.change(input, { target: { value: "CONFIRM LIVE TRADING" } });
    const confirmBtn = screen.getByRole("button", { name: /Enable live trading/i });
    expect(confirmBtn).not.toBeDisabled();
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(onModeChange).toHaveBeenCalledWith("live"));
    vi.unstubAllGlobals();
  });
});
