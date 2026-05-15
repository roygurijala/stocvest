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

/** Scanner gap card — event significance 0–100 (not a trade signal). */
export const EVENT_SIGNIFICANCE_SCORE_TIP =
  "Liquidity, volume validation, news relevance, and move magnitude — combined into how notable the gap event is, not whether to trade it.";

export const INTRADAY_SETUPS_TIP =
  "Real-time trading opportunities identified during market hours based on price action and volume patterns. Updated every 5 minutes by the scanner engine.";

export const PDT_GUARDIAN_TIP =
  "The Pattern Day Trader rule limits brokerage accounts under $25,000 to 3 day trades within any 5 business days. STOCVEST enforces this automatically at the broker layer so your account is never restricted by accident.";

export const CONFIDENCE_PERCENT_TIP =
  "When confluence is available, this number is mostly that score (0–100) with a small contribution from the active pattern score (swing or day path, depending on mode) so similar confluence does not always print as an identical percent. Confluence reflects how many independent context checks align (structure, regime, sector, news, gaps), minus conflict penalties. Without confluence, this is pattern-only; many marginal setups share the same gateway value (for example 55%) because that is the minimum score to pass the scanner.";

export const SETUP_RELATIVE_VOLUME_TIP =
  "How today's trading volume compares to the 20-day average. 2x means twice the normal activity. Higher volume confirms stronger price moves and more reliable signals.";

export const TOP_SIGNALS_TIP =
  "The strongest active scanner names on the board right now, ranked with swing-first defaults. The percentage weights confluence heavily when the API includes it, with a small blend from the pattern score so ties are less common; otherwise it is pattern-only.";

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

/** ─── Dashboard cards (umbrella copy for circled i on each panel) ─── */

export const DASHBOARD_MARKET_SENTIMENT_CARD_TIP =
  "This panel summarizes how large-cap, tech, and small-cap indices are moving versus yesterday’s close. STOCVEST uses it as a fast tape read for swing workflow—risk appetite and breadth—before you drill into a symbol’s Evidence or six-layer composite. It is not a trade signal by itself.";

export const WEEKLY_MARKET_CONTEXT_CARD_TIP =
  "Shows roughly five **trading sessions** of change on SPY, QQQ, and IWM using **daily** closes (Polygon aggregates), plus last price from the snapshot. **Green and red here describe tape context** (short-term bias and how today is trading inside its range) — **not** buy/sell permission; actionable gates live on the desks with their own indicators. Used by **Swing and Day** workflows to frame risk and constraints — descriptive only, not a directive to trade.";

/** Section A — SPY/QQQ/IWM horizontal daily-return bars (InfoTip on chart). */
export const SHARED_CONTEXT_HISTOGRAM_TIP =
  "• **Horizontal bars:** daily **close‑to‑close** returns (last ~5 cash sessions), oldest row at the **top**, most recent at the **bottom**.\n• **Bar length:** scaled **per index** to that symbol’s **largest |daily return|** in the window — compare magnitudes **within** one card (SPY vs SPY), not across cards.\n• **Number below:** **cumulative** return over those same sessions (5‑session net).\n• **Purpose:** shared **market context** only — not a trade signal.";

/** Intraday position gauge under each index tile (Section A). */
export const SHARED_CONTEXT_INTRADAY_GAUGE_TIP =
  "**Intraday position** — where the **last price** sits inside **today’s cash‑session high–low** (today only; separate from the 5‑session bars above).\n\n• **Near the left** → weak session (pressed toward the low)\n• **Near the right** → strong session (bid toward the high)\n• **Middle** → balanced / chop inside the range\n\nDay traders: pair **5‑session net** (short‑term trend/bias) with this **dot** (how **today** is behaving) — e.g. “down on the week but recovering intraday.” Context only, not entry permission.";

export const MARKET_PULSE_CARD_TIP =
  "SPY, QQQ, and VIX session change plus a simple regime label—useful context for how today’s session sits next to a swing thesis. When the scanner finishes, these numbers match the same tape inputs used in gap and setup context; otherwise they come from your market overview snapshots. They inform macro-style context in the engine, not individual entry prices.";

export const TOP_SIGNALS_CARD_TIP =
  "Ideas from the overnight multi-day (swing) stock scan on this home page only—not same-day session patterns. Open Evidence on a symbol for news, levels, and the full six-layer read. Use the Scanner page for combined day-trading and swing lists.";

/** Empty swing “Primary read” strip — explains headline + “swing suppressed” + filter lines in plain language. */
export const PRIMARY_READ_SWING_CONTEXT_TIP =
  "System posture means the app is waiting: it is watching the market but is not highlighting swing (multi-day) ideas until its checks line up.\n\nSwing suppressed means the daily swing scanner finished and did not find stocks that met the quality bar. That is usually expected behavior, not an outage.\n\nSymbol-level confirmation means each ticker is judged on its own—enough price history, a strong enough pattern score, trading activity, and complete quote data. If the broad market looks fine but no individual names pass those checks, you will see wording about filters or confirmations instead of a ticker list.";

export const SWING_REENABLE_CALLOUT_TIP =
  "This checklist describes what typically has to improve before new swing rows can show up again: how the big indexes are labeled today, whether sectors agree with that story, weekly index tone, and whether specific stocks pass the scanner’s per-name quality bar. It is not a price forecast—only the kinds of inputs STOCVEST already watches when it decides to show or hide ideas.\n\nWhen bullets mention the overnight scanner, read that as the automated daily review that must sign off on each stock before it can appear here.";

export const WATCHLIST_READINESS_TIP =
  "A pass/fail count for the stocks the home dashboard tried to evaluate for swing ideas. It never lists ticker symbols; it only signals whether the empty board is because almost nothing was checked or because nothing cleared the bar.";

export const WATCHLIST_READINESS_DETAIL_INTRO =
  "Plain-language read: readiness is how many names passed the swing quality checks versus how many were scanned. The line below states the outcome using the same rules the scanner applies.";

export const ALIGNMENT_LADDER_TIP =
  "A simple stack that shows how macro context, today’s large-cap tape label, sector leadership, weekly index momentum, and the swing list relate. The words describe alignment only—they are not buy or sell instructions, and they do not replace opening Evidence on a stock.";

export const TOP_SIGNAL_ROW_CARD_TIP =
  "A single scanner candidate. Entry zone, stop/target, and R:R are **reference geometry** from the session snapshot (same style as Evidence reference levels), not guaranteed fills. Pattern line translates day-scanner triggers into swing-readable language; catalyst line uses the earnings calendar when available. Open Evidence for the full six-layer composite.";

export const EARNINGS_CALENDAR_CARD_TIP =
  "Earnings dates for symbols on your dashboard list. Reporting days add event risk: STOCVEST surfaces them so you can weigh gap risk and news volatility before acting on a setup.";

export const SECTOR_ROTATION_CARD_TIP =
  "Sector ETFs (XLK, XLC, XLE, …) with the same ~5 **trading sessions** of daily closes as the weekly index row—not today’s session % beside Market pulse. When chips disagree with Regime, the panel explains that gap (rotation vs benchmark, timing window, breadth).";

export const UPCOMING_CATALYSTS_CARD_TIP =
  "Earnings dates only — same feed as the calendar below, limited to your dashboard symbol list. Fed, CPI, and other macro calendars are not wired into this panel yet; an empty list does not mean there is nothing on the macro calendar.";

export const SIGNAL_VALIDATION_LEDGER_CARD_TIP =
  "Shortcut to **Signal validation ledger** — logged outcomes of your STOCVEST decisions (swing vs day) under fixed rules. This is not a brokerage account, managed capital, or performance marketing.";

export const MORNING_BRIEF_CARD_TIP =
  "Structured pre-market brief: futures tone, VIX direction, economic prints, and a highlighted watch. It is a narrative digest of conditions, separate from the ranked scanner list below.";

/** ─── Decision metric tooltips (how a number feeds the product) ─── */

export const SENTIMENT_SCORE_NUMBER_TIP =
  "This headline score averages a simple 0–100 translation of SPY, QQQ, and IWM session change. It only drives this dashboard gauge and copy like “favor today”—a tape tilt for planning, not the same math as the per-stock composite score.";

export const SENTIMENT_FROM_OPEN_TIP =
  "Shows how today’s opening gap versus prior close shifted the same 0–100 index sub-scores on average. A negative read means the open was weaker than prior close; use it alongside the headline score to see session give-back or recovery versus the open.";

export const INDEX_SUBSCORE_TIP =
  "A 0–100 shorthand from that index’s session change versus prior close. It colors the small index tile and feeds the headline gauge; the swing or real composite for an individual stock uses its own bars and layers.";

export const INDEX_LAST_PRICE_DECISION_TIP =
  "Last traded price for context on the tape card. When you open Evidence on a symbol, STOCVEST refreshes snapshot data for the composite—not this static tile.";

export const INDEX_SESSION_CHANGE_DECISION_TIP =
  "Session percent change versus prior close for that index. Macro and internals-style context in the engine use broad market direction; large down prints often coincide with more defensive tilts when other layers are ambiguous.";

export const SPY_PULSE_NUMBER_TIP =
  "SPY session change is a primary macro breadth proxy in STOCVEST. It helps label regime (bullish / neutral / bearish) together with QQQ; it does not set stops or targets on any trade.";

export const QQQ_PULSE_NUMBER_TIP =
  "QQQ session change reflects tech-heavy risk appetite. When it diverges from SPY, the UI calls out a skew (growth vs broad); the composite still evaluates each stock on its own merits.";

export const VIX_PULSE_NUMBER_TIP =
  "VIX level and session change feed fear/grease context. Elevated VIX raises caution in macro and internals-style scoring; it is one input among six layers on a full composite.";

export const REGIME_BADGE_TIP =
  "On this dashboard the regime word is derived from SPY and QQQ session change only (scanner path when both prints are present, otherwise overview snapshots). VIX on the same line is tape context only—it does not change the bullish / neutral / bearish label. When VIX is blank, the badge notes completeness so you are never left guessing whether vol agreed, was skipped, or the market was simply closed. Open Evidence for full six-layer composite math.";

/** Appended to `REGIME_BADGE_TIP` when VIX is absent from the pulse row (DecisionMetric). */
export const REGIME_WITHOUT_VIX_APPEND =
  " VIX is not on this read — a blank VIX field is not an implicit low-volatility signal. The label above still follows SPY/QQQ rules only; when it is directional we mark price + breadth until VIX prints in this panel.";

/** VIX shows “—” and equities session is not regular open — expected stale / no fresh print. */
export const VIX_BLANK_MARKET_CLOSED_TIP =
  "VIX is built from SPX options and normally updates during regular US equity hours. Pre-market, post-market, weekends, and some holidays often have no fresh index-style print here. Showing “—” is correct; it does not mean your account is broken.";

/** VIX missing while the tape row otherwise has data — upstream gap or partial outage. */
export const VIX_BLANK_UPSTREAM_TIP =
  "The overview or options path did not return a usable VIX for this load (feed hiccup, partial outage, or symbol missing in the response). A blank here means implied volatility is absent from this line—not that vol is necessarily low. The dashboard regime badge still uses SPY and QQQ only; see its tooltip for how completeness is labeled.";

/** Tape not ready yet — SPY/QQQ also missing so the row is still filling. */
export const VIX_BLANK_DATA_PENDING_TIP =
  "Market snapshots are still loading or the first response has not included VIX yet. Wait for a refresh; until then treat the dash as pending data, not a neutral vol read.";

export const LAST_PRICE_SIGNAL_CARD_TIP =
  "Last price captured with this scanner row. Opening Evidence fetches a fresh snapshot for the composite and resolution logic—use this figure as a quick reference only.";

export const CONFLUENCE_COUNT_DECISION_TIP =
  "Counts how many independent context checks (structure, regime, sector hooks, etc.) line up on this setup. Higher alignment raises scanner rank; conflicts reduce priority before you pull a full composite.";

export const GEO_WEIGHTED_EXPOSURE_TIP =
  "A condensed geopolitical exposure score for this symbol’s sector from recent headlines. It nudges scanner context when themes (energy, defense, trade) spike; the full geo layer in the composite uses a broader headline sample when you open Evidence.";

export const EARNINGS_IMPACT_BADGE_TIP =
  "Rough liquidity proxy from market cap: larger names tend to move indexes and your watchlist more on earnings day. It does not predict beat or miss—only how noisy the tape might be.";

export const EARNINGS_EPS_SURPRISE_TIP =
  "Actual EPS versus the consensus estimate, plus surprise percent when available. STOCVEST shows it so you can judge how much the report is ‘news’ versus expectations—helpful context next to a technical setup, not a standalone signal.";

export const SESSION_STATUS_STRIP_TIP =
  "Shows whether US equities are open or closed and a quick VIX read when available. This strip is for situational awareness only—it does not alter the six-layer composite scores.";
