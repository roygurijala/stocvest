import type { SignalsSectionLink } from "@/components/signals/signals-section-nav";

export const SIGNALS_SECTION_TARGET = {
  setup: "signals-section-setup",
  layers: "signals-layers",
  radar: "signals-section-radar",
  evolution: "signals-section-evolution",
  context: "signals-section-context"
} as const;

export function buildSignalsSectionLinks(input: {
  hasValidSignal: boolean;
  hasRadar: boolean;
  hasAfterHours: boolean;
}): SignalsSectionLink[] {
  if (!input.hasValidSignal) return [];
  const links: SignalsSectionLink[] = [
    { id: "setup", label: "Setup", targetId: SIGNALS_SECTION_TARGET.setup },
    { id: "layers", label: "Layers", targetId: SIGNALS_SECTION_TARGET.layers },
    { id: "evolution", label: "Past states", targetId: SIGNALS_SECTION_TARGET.evolution }
  ];
  if (input.hasRadar) {
    links.splice(2, 0, { id: "radar", label: "Radar", targetId: SIGNALS_SECTION_TARGET.radar });
  }
  if (input.hasAfterHours) {
    links.push({ id: "context", label: "Context", targetId: SIGNALS_SECTION_TARGET.context });
  }
  return links;
}
