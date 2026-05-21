"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "@/lib/theme-provider";

export type SignalsSectionId = "setup" | "layers" | "radar" | "evolution" | "context";

export type SignalsSectionLink = {
  id: SignalsSectionId;
  label: string;
  targetId: string;
};

type Props = {
  sections: SignalsSectionLink[];
};

export function SignalsSectionNav({ sections }: Props) {
  const { colors } = useTheme();
  const [active, setActive] = useState<SignalsSectionId>(sections[0]?.id ?? "setup");
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    if (sections.length === 0) return;
    if (typeof IntersectionObserver === "undefined") return;
    const targets = sections
      .map((s) => document.getElementById(s.targetId))
      .filter((el): el is HTMLElement => el != null);
    if (targets.length === 0) return;

    observerRef.current?.disconnect();
    observerRef.current = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]?.target.id) {
          const match = sections.find((s) => s.targetId === visible[0].target.id);
          if (match) setActive(match.id);
        }
      },
      { rootMargin: "-20% 0px -55% 0px", threshold: [0, 0.12, 0.35] }
    );
    for (const el of targets) observerRef.current.observe(el);
    return () => observerRef.current?.disconnect();
  }, [sections]);

  const scrollTo = useCallback((targetId: string, sectionId: SignalsSectionId) => {
    const el = document.getElementById(targetId);
    if (!el) return;
    setActive(sectionId);
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  if (sections.length < 2) return null;

  return (
    <nav
      aria-label="Jump to section"
      data-testid="signals-section-nav"
      className="signals-section-nav -mx-1 flex gap-1.5 overflow-x-auto pb-0.5 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      style={{ WebkitOverflowScrolling: "touch" }}
    >
      {sections.map((section) => {
        const isActive = active === section.id;
        return (
          <button
            key={section.id}
            type="button"
            data-testid={`signals-section-nav-${section.id}`}
            aria-current={isActive ? "true" : undefined}
            className="shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors"
            style={{
              borderColor: isActive ? colors.accent : colors.border,
              background: isActive
                ? `color-mix(in srgb, ${colors.accent} 18%, ${colors.surfaceMuted})`
                : colors.surfaceMuted,
              color: isActive ? colors.text : colors.textMuted,
              boxShadow: isActive ? `0 0 12px color-mix(in srgb, ${colors.accent} 35%, transparent)` : undefined
            }}
            onClick={() => scrollTo(section.targetId, section.id)}
          >
            {section.label}
          </button>
        );
      })}
    </nav>
  );
}
