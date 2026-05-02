import type { ScannerOverview } from "@/lib/api/scanner";

interface ScannerOverviewPanelProps {
  overview: ScannerOverview;
}

export function ScannerOverviewPanel({ overview }: ScannerOverviewPanelProps) {
  return (
    <section style={{ marginTop: 18 }}>
      <h2 style={{ marginBottom: 10 }}>Scanner Overview</h2>
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
        <article style={{ background: "#101a32", borderRadius: 12, padding: 16 }}>
          <h3 style={{ marginTop: 0 }}>Gap Signal Candidates</h3>
          {overview.gaps.length === 0 ? (
            <p style={{ opacity: 0.85 }}>{overview.error ? "Unavailable" : "No candidates"}</p>
          ) : (
            <ul style={{ margin: "8px 0 0 18px", padding: 0 }}>
              {overview.gaps.slice(0, 5).map((item) => (
                <li key={item.symbol}>
                  {item.symbol}: {item.gap_percent.toFixed(2)}%
                </li>
              ))}
            </ul>
          )}
        </article>

        <article style={{ background: "#101a32", borderRadius: 12, padding: 16 }}>
          <h3 style={{ marginTop: 0 }}>News Catalysts</h3>
          {overview.catalysts.length === 0 ? (
            <p style={{ opacity: 0.85 }}>{overview.error ? "Unavailable" : "No catalysts"}</p>
          ) : (
            <ul style={{ margin: "8px 0 0 18px", padding: 0 }}>
              {overview.catalysts.slice(0, 5).map((item) => (
                <li key={item.article_id}>
                  {item.symbol}: {item.catalyst_type}
                </li>
              ))}
            </ul>
          )}
        </article>

        <article style={{ background: "#101a32", borderRadius: 12, padding: 16 }}>
          <h3 style={{ marginTop: 0 }}>Intraday Setups</h3>
          {overview.setups.length === 0 ? (
            <p style={{ opacity: 0.85 }}>{overview.error ? "Unavailable" : "No setups"}</p>
          ) : (
            <ul style={{ margin: "8px 0 0 18px", padding: 0 }}>
              {overview.setups.slice(0, 5).map((item) => (
                <li key={`${item.symbol}-${item.timestamp_iso}`}>
                  {item.symbol}: {item.direction} ({item.score.toFixed(2)})
                </li>
              ))}
            </ul>
          )}
        </article>
      </div>
      {overview.briefing ? (
        <article style={{ background: "#101a32", borderRadius: 12, padding: 16, marginTop: 12 }}>
          <h3 style={{ marginTop: 0 }}>{overview.briefing.title}</h3>
          <p style={{ margin: "0 0 12px 0", fontSize: 13, opacity: 0.85, lineHeight: 1.5 }}>
            Signal data for informational purposes only. Not investment advice. Past signal performance does not guarantee future results.
          </p>
          <pre style={{ whiteSpace: "pre-wrap", margin: 0, fontFamily: "inherit", opacity: 0.9 }}>
            {overview.briefing.markdown}
          </pre>
        </article>
      ) : null}
    </section>
  );
}
