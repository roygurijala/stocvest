export function LandingAhaSection() {
  const rows = [
    { label: "You were right on direction", ok: true },
    { label: "You entered too early", ok: false },
    { label: "Your stop was too tight", ok: false },
    { label: "Your reward wasn't worth the risk", ok: false }
  ] as const;

  return (
    <section className="mx-auto max-w-4xl px-4 py-16 md:px-8" data-testid="landing-aha-section">
      <h2 className="text-center text-2xl font-bold md:text-3xl">
        Why traders lose — even when they&apos;re right
      </h2>
      <p className="mx-auto mt-3 max-w-xl text-center text-slate-300">
        You&apos;re not wrong — you&apos;re early, late, or undisciplined. Most losses are bad entries, not bad
        ideas.
      </p>
      <ul className="landing-glow-card mx-auto mt-8 max-w-lg space-y-3 p-6">
        {rows.map((row) => (
          <li key={row.label} className="flex items-center gap-3 text-base">
            <span className={row.ok ? "text-emerald-400" : "text-rose-400"} aria-hidden>
              {row.ok ? "✓" : "✗"}
            </span>
            <span className="text-slate-100">{row.label}</span>
          </li>
        ))}
      </ul>
      <p className="mt-6 text-center text-lg font-semibold text-cyan-200">
        STOCVEST fixes execution discipline, not just signals.
      </p>
    </section>
  );
}
