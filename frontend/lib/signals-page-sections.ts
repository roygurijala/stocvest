import type { SignalsSectionLink } from "@/components/signals/signals-section-nav";

export const SIGNALS_SECTION_TARGET = {
  setup: "signals-section-setup",
  layers: "signals-layers",
  radar: "signals-section-radar",
  evolution: "signals-section-evolution",
  context: "signals-section-context",
  /** Setup tab — why execution is withheld. */
  whyNotActionable: "signals-section-why-not-actionable",
  /** Setup tab — how composite derived Bullish / Bearish / Neutral. */
  biasRationale: "signals-section-bias-rationale",
  /** Setup tab — execution read + conviction when actionable or detail block. */
  executionDetail: "signals-section-execution-detail"
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

/** Smooth-scroll to a section anchor; retries until the tab panel mounts. */
export function scrollToSignalsSection(
  targetId: string,
  options?: { fallbackId?: string; maxAttempts?: number }
): void {
  const maxAttempts = options?.maxAttempts ?? 12;
  let attempt = 0;

  const resolveScrollOffsetPx = (): number => {
    let offset = 12;
    const sticky = document.querySelector<HTMLElement>('[data-testid="signals-sticky-command"]');
    if (sticky) offset += sticky.getBoundingClientRect().height;
    const tabNav = document.querySelector<HTMLElement>('[data-testid="signals-desk-tab-nav-wrap"]');
    if (tabNav) offset += tabNav.getBoundingClientRect().height;
    return offset;
  };

  const tryScroll = () => {
    const el =
      document.getElementById(targetId) ??
      (options?.fallbackId ? document.getElementById(options.fallbackId) : null);
    if (el) {
      const top = el.getBoundingClientRect().top + window.scrollY - resolveScrollOffsetPx();
      window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
      return;
    }
    attempt += 1;
    if (attempt < maxAttempts) {
      window.requestAnimationFrame(tryScroll);
    }
  };

  window.requestAnimationFrame(tryScroll);
}
