const STEPS = [
  { n: 1, title: "Add your watchlist", body: "Track the names you actually trade — not a firehose." },
  { n: 2, title: "See which setups are forming", body: "Scanner and desk show alignment before you click in." },
  { n: 3, title: "Open signals when alignment is strong", body: "Actionable only when layers and R/R agree." },
  { n: 4, title: "Ask the assistant", body: "Understand why to take it — or skip with confidence." },
  { n: 5, title: "Execute — or stay out", body: "Permission to wait is a feature, not a failure." }
] as const;

export function LandingFirstMinutesSection() {
  return (
    <section
      id="how-it-works"
      className="mx-auto max-w-5xl px-4 py-16 md:px-8"
      data-testid="landing-first-minutes"
    >
      <h2 className="text-center text-2xl font-bold md:text-3xl">Your first 5 minutes inside STOCVEST</h2>
      <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {STEPS.map((step) => (
          <li key={step.n} className="landing-glow-card p-5 text-left">
            <span className="text-2xl font-black text-cyan-400">{step.n}</span>
            <h3 className="mt-2 font-semibold text-slate-50">{step.title}</h3>
            <p className="mt-1 text-sm text-slate-300">{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
