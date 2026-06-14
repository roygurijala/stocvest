import { describe, expect, test } from "vitest";
import {
  filterOutcomeEvents,
  groupOutcomeEventsBySymbol,
  outcomeMatchesFilter
} from "@/lib/setup-outcomes-present";
import type { SetupOutcomeEvent } from "@/lib/api/setup-outcomes";

const sample: SetupOutcomeEvent[] = [
  {
    symbol: "MSFT",
    mode: "swing",
    session_date: "2026-06-08",
    event_state: "developing",
    layers_aligned: 4,
    layers_total: 6,
    bias: "long",
    outcome_kind: "setup_continuation",
    next_session_date: "2026-06-09",
    next_layers_aligned: 4,
    next_state: "developing"
  },
  {
    symbol: "NVDA",
    mode: "swing",
    session_date: "2026-06-08",
    event_state: "developing",
    layers_aligned: 3,
    layers_total: 6,
    bias: "long",
    outcome_kind: "alignment_weakened",
    next_session_date: "2026-06-09",
    next_layers_aligned: 2,
    next_state: "not_aligned"
  }
];

describe("setup-outcomes-present", () => {
  test("outcomeMatchesFilter bias_confirmed", () => {
    expect(outcomeMatchesFilter("setup_continuation", "bias_confirmed")).toBe(true);
    expect(outcomeMatchesFilter("alignment_held", "bias_confirmed")).toBe(false);
  });

  test("filterOutcomeEvents held includes continuation", () => {
    const held = filterOutcomeEvents(sample, "held");
    expect(held).toHaveLength(1);
    expect(held[0].symbol).toBe("MSFT");
  });

  test("groupOutcomeEventsBySymbol", () => {
    const groups = groupOutcomeEventsBySymbol(sample);
    expect(groups).toHaveLength(2);
    expect(groups[0].symbol).toBe("MSFT");
  });
});
