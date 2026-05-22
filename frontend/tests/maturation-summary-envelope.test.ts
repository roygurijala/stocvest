import { describe, expect, it } from "vitest";
import { parseMaturationSummaryEnvelope } from "@/lib/watchlist/maturation-summary-envelope";

describe("parseMaturationSummaryEnvelope", () => {
  it("reads near_ready aggregate fields from API", () => {
    const env = parseMaturationSummaryEnvelope({
      mode: "swing",
      near_ready_count: 2,
      near_ready_symbols: ["AMD", "NVDA"],
      by_symbol: {
        AMD: { state: "developing", label: "Developing", layers_aligned: 4, progress_band: "near_ready" },
        NVDA: { state: "developing", label: "Developing", layers_aligned: 4, progress_band: "near_ready" },
        MSFT: { state: "developing", label: "Developing", layers_aligned: 3, progress_band: "developing" }
      }
    });
    expect(env.mode).toBe("swing");
    expect(env.nearReadyCount).toBe(2);
    expect(env.nearReadySymbols).toEqual(["AMD", "NVDA"]);
    expect(env.bySymbol.AMD?.progress_band).toBe("near_ready");
  });

  it("falls back near_ready_symbols from rows when aggregate omitted", () => {
    const env = parseMaturationSummaryEnvelope({
      mode: "day",
      by_symbol: {
        TSLA: { state: "developing", label: "Developing", layers_aligned: 4, progress_band: "near_ready" }
      }
    });
    expect(env.nearReadySymbols).toEqual(["TSLA"]);
    expect(env.nearReadyCount).toBe(1);
  });
});
