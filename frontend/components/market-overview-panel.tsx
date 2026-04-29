import type { MarketOverview } from "@/lib/api/market";

interface MarketOverviewPanelProps {
  overview: MarketOverview;
}

export function MarketOverviewPanel({ overview }: MarketOverviewPanelProps) {
  return (
    <section style={{ marginTop: 18 }}>
      <h2 style={{ marginBottom: 10 }}>Market Overview</h2>
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
        <article style={{ background: "#101a32", borderRadius: 12, padding: 16 }}>
          <h3 style={{ marginTop: 0 }}>Session Status</h3>
          {overview.error ? (
            <p style={{ color: "#fda4af" }}>{overview.error}</p>
          ) : (
            <>
              <p style={{ margin: "0 0 6px 0" }}>
                Market: <strong>{overview.status?.market || "unknown"}</strong>
              </p>
              <p style={{ margin: 0, opacity: 0.85 }}>
                Time: {overview.status?.server_time || "n/a"}
              </p>
            </>
          )}
        </article>

        <article style={{ background: "#101a32", borderRadius: 12, padding: 16 }}>
          <h3 style={{ marginTop: 0 }}>Watchlist Snapshots</h3>
          {overview.snapshots.length === 0 ? (
            <p style={{ opacity: 0.85 }}>No snapshot data.</p>
          ) : (
            <ul style={{ margin: "8px 0 0 18px", padding: 0 }}>
              {overview.snapshots.map((snapshot) => (
                <li key={snapshot.symbol}>
                  {snapshot.symbol}: {snapshot.last_trade_price ?? "n/a"}
                  {snapshot.prev_close ? ` (${(((snapshot.last_trade_price || 0) - snapshot.prev_close) / snapshot.prev_close * 100).toFixed(2)}%)` : ""}
                </li>
              ))}
            </ul>
          )}
        </article>

        <article style={{ background: "#101a32", borderRadius: 12, padding: 16 }}>
          <h3 style={{ marginTop: 0 }}>Latest Headlines</h3>
          {overview.news.length === 0 ? (
            <p style={{ opacity: 0.85 }}>No market news available.</p>
          ) : (
            <ul style={{ margin: "8px 0 0 18px", padding: 0 }}>
              {overview.news.slice(0, 5).map((article) => (
                <li key={article.article_id}>
                  {article.title} {article.source ? `(${article.source})` : ""}
                </li>
              ))}
            </ul>
          )}
        </article>
      </div>
    </section>
  );
}
