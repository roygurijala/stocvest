import type { GapIntelSnapshot } from "@/lib/api/gap-intel";
import type { AssistantGapIntel } from "@/lib/assistant/types";

/** Whitelisted assistant payload — must stay in lockstep with `serialize_page_context`. */
export function narrowGapIntelForAssistant(s: GapIntelSnapshot | null | undefined): AssistantGapIntel | undefined {
  if (!s) return undefined;
  return {
    phase: { state: s.phase.state, label: s.phase.label },
    gap: {
      direction: s.gap.direction,
      status: s.gap.status,
      resolution_state: s.gap.resolution_state
    },
    levels: {
      fill_level: s.levels.fill_level,
      fill_source: s.levels.fill_source,
      fill_reliability: s.levels.fill_reliability
    },
    liquidity: { is_high_liquidity: s.liquidity.is_high_liquidity },
    scenario_builder: {
      state: s.scenario_builder.state,
      reasons: [...(s.scenario_builder.reasons ?? [])]
    },
    flags: {
      calendar_state: s.flags.calendar_state,
      stale: s.flags.stale
    }
  };
}
