/**
 * Bridge ScenarioInput reference levels → variant catalog geometry.
 */

import type { ScenarioInput } from "@/lib/scenario/types";
import type { ScenarioGeometrySource } from "@/lib/scenario/scenario-variants";

export function scenarioInputToGeometrySource(input: ScenarioInput): ScenarioGeometrySource | null {
  const direction = input.direction;
  if (direction !== "bullish" && direction !== "bearish") return null;
  const ref = input.reference;
  return {
    direction,
    entryZoneLow: typeof ref.entry_low === "number" ? ref.entry_low : null,
    entryZoneHigh: typeof ref.entry_high === "number" ? ref.entry_high : null,
    last: typeof ref.current_price === "number" ? ref.current_price : null,
    structuralStop: typeof ref.stop === "number" ? ref.stop : null,
    target1: typeof ref.target_1 === "number" ? ref.target_1 : null,
    target2: typeof ref.target_2 === "number" ? ref.target_2 : null,
    vwap: typeof ref.vwap === "number" ? ref.vwap : null,
    atr: typeof ref.atr === "number" ? ref.atr : null,
    systemRiskReward: typeof input.risk_reward === "number" ? input.risk_reward : null
  };
}
