/** User-facing copy for info icons (no proprietary weights). */

export const MARKET_SENTIMENT_SCORE_TIP =
  "A score from 0 to 100 showing overall market health. Above 55 means more signals are bullish than bearish. Below 45 means more signals are cautious or bearish.";

export const SPY_CARD_TIP =
  "SPY tracks the S&P 500 — the 500 largest US companies. It is the most widely watched indicator of overall US stock market health.";

export const QQQ_CARD_TIP =
  "QQQ tracks the Nasdaq 100 — the top 100 technology and growth companies. Rising QQQ usually signals risk appetite is healthy.";

export const IWM_CARD_TIP =
  "IWM tracks the Russell 2000 — 2000 smaller US companies. When IWM leads the market higher it signals broad economic confidence, not just big tech.";

export const GAP_CANDIDATES_TIP =
  "Stocks that opened significantly higher or lower than yesterday's close, usually driven by overnight earnings, news, or analyst actions. Gaps with high volume are the most reliable day trading setups.";

export const NEWS_CATALYSTS_TIP =
  "Stocks with significant news events today that could drive price movement. Earnings reports, FDA decisions, analyst upgrades, and major contracts all qualify as catalysts.";

export const GAP_INTELLIGENCE_TIP =
  "Pre-market gaps ranked by quality, volume versus average, and whether same-day news supports the move. Gaps without a clear catalyst are flagged as higher reversal risk.";

export const INTRADAY_SETUPS_TIP =
  "Real-time trading opportunities identified during market hours based on price action and volume patterns. Updated every 5 minutes by the scanner engine.";

export const PDT_GUARDIAN_TIP =
  "The Pattern Day Trader rule limits brokerage accounts under $25,000 to 3 day trades within any 5 business days. STOCVEST enforces this automatically at the broker layer so your account is never restricted by accident.";

export const CONFIDENCE_PERCENT_TIP =
  "When confluence is available, this number is mostly that score (0–100) with a small contribution from the intraday pattern score so similar confluence does not always print as an identical percent. Confluence reflects how many independent context checks align (structure, regime, sector, news, gaps), minus conflict penalties. Without confluence, this is pattern-only; many marginal setups share the same gateway value (for example 55%) because that is the minimum score to pass the scanner.";

export const SETUP_RELATIVE_VOLUME_TIP =
  "How today's trading volume compares to the 20-day average. 2x means twice the normal activity. Higher volume confirms stronger price moves and more reliable signals.";

export const TOP_SIGNALS_TIP =
  "The strongest active intraday candidates from the scanner right now. The percentage weights confluence heavily when the API includes it, with a small blend from the pattern score so ties are less common; otherwise it is pattern-only.";

export const LATEST_HEADLINES_TIP =
  "Real-time market news from Polygon.io. Headlines are scored for sentiment and used as one of the six signal layers.";

export const AI_VERDICT_TIP =
  "Claude AI reads all six signal layers simultaneously and writes a plain-English synthesis of what the data shows, where signals align, where they conflict, and what risks to monitor.";

export const WIN_RATE_TIP =
  "The percentage of your closed trades that were profitable. Most professional traders target between 55 and 65 percent. A lower win rate can still be profitable if your average winner is larger than your average loser.";

export const EXPECTANCY_TIP =
  "Your average profit per trade accounting for both wins and losses. Positive expectancy means your overall strategy makes money over time even with a sub-50 percent win rate.";

export const AVG_WINNER_TIP =
  "The average profit on your winning trades in dollars. For a healthy trading strategy this should be at least 1.5 to 2 times larger than your average loser.";

export const AVG_LOSER_TIP =
  "The average loss on your losing trades in dollars. Keeping this smaller than your average winner is the foundation of profitable trading.";

export const STREAK_TIP =
  "Your current consecutive wins or losses. A losing streak is normal — even professional traders have them. Focus on the overall win rate and expectancy, not individual streaks.";

export const LAYER_NAME_HINTS: Record<string, string> = {
  technical: "Price action analysis using RSI, VWAP, moving averages, and momentum indicators. Shows whether the stock's current price movement is bullish or bearish.",
  news: "AI analysis of recent news articles about this stock. Each headline is scored for positive or negative market impact and combined into a sentiment score.",
  macro: "Broader economic conditions including Federal Reserve policy, interest rates, inflation data, and upcoming economic events that could move markets.",
  sector: "How the stock's industry sector is performing relative to the S&P 500. Stocks in leading sectors are more likely to continue higher.",
  geopolitical:
    "Global events that could impact markets including trade tensions, political instability, and international conflicts affecting supply chains or investor sentiment.",
  internals:
    "Market-wide health indicators including how many stocks are rising versus falling, the VIX volatility index, and advance-decline line breadth."
};
