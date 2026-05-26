"use client";

type Props = {
  filled: boolean[];
  total: number;
  accent: string;
};

export function DashboardLayerDots({ filled, total, accent }: Props) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-hidden>
      {filled.map((on, i) => (
        <span
          key={i}
          className="text-xs leading-none"
          style={{ color: on ? accent : "color-mix(in srgb, currentColor 35%, transparent)" }}
        >
          {on ? "●" : "○"}
        </span>
      ))}
      <span className="ml-1 text-[10px] font-medium opacity-80">
        ({filled.filter(Boolean).length}/{total})
      </span>
    </span>
  );
}
