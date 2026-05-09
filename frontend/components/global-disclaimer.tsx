export function GlobalDisclaimer() {
  return (
    <div
      style={{
        borderTop: "1px solid rgba(255,255,255,0.06)",
        padding: "20px 24px",
        textAlign: "center",
        fontSize: "11px",
        color: "#4a6080",
        lineHeight: "1.8",
        letterSpacing: "0.2px"
      }}
    >
      STOCVEST is a signal intelligence platform, not a registered investment adviser. Signals and analysis are provided for
      informational and educational purposes only and do not constitute investment advice, a solicitation, or a recommendation to buy or
      sell any security. All trading decisions are solely your responsibility. Past signal accuracy does not guarantee future results.
      Trading involves substantial risk of loss and is not suitable for all investors.
      <br />
      <br />
      © 2026 STOCVEST LLC · <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a> ·{" "}
      <a href="/legal/risk-disclosure">Risks</a> · <a href="/dashboard/legal">Your agreements</a> · Not investment advice
    </div>
  );
}
