"use client";

export function InfoTip({ text, label }: { text: string; label?: string }) {
  return (
    <span className="group relative inline-flex align-middle">
      <span
        role="img"
        aria-label={label ?? "More information"}
        className="inline-flex cursor-help text-xs opacity-80 transition hover:opacity-100"
      >
        ℹ️
      </span>
      <span className="pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-40 w-[250px] -translate-x-1/2 rounded-md bg-[#0f172a] px-3 py-2 text-xs leading-relaxed text-white opacity-0 shadow-xl transition-opacity duration-200 group-hover:opacity-100">
        {text}
      </span>
    </span>
  );
}
