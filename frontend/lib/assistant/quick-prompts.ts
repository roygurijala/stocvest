import type { AssistantDecisionState, AssistantPageContext } from "@/lib/assistant/types";

const MAX_PROMPTS = 3;

function sym(ctx: AssistantPageContext): string | null {
  const s = ctx.symbol?.trim().toUpperCase();
  return s || null;
}

function dissentingLayerNames(ctx: AssistantPageContext): string[] {
  const ls = ctx.layer_status;
  if (!ls) return [];
  const out: string[] = [];
  for (const [key, status] of Object.entries(ls)) {
    if (status === "Bearish" || status === "Unavailable") {
      out.push(key);
    }
  }
  return out.slice(0, 2);
}

function monitorPrompts(ctx: AssistantPageContext, ticker: string): string[] {
  const cat = ctx.decision_rationale?.category;
  const rr = ctx.risk_reward;
  const prompts: string[] = [];
  if (cat === "risk_reward" || (typeof rr === "number" && rr < 2)) {
    prompts.push(`Why is ${ticker}'s risk/reward keeping this in Monitor?`);
  } else if (cat === "confirmation") {
    prompts.push(`What confirmation is ${ticker} still missing?`);
  } else if (cat === "regime") {
    prompts.push(`How is market regime affecting ${ticker}'s Decision?`);
  } else if (cat === "readiness") {
    prompts.push(`What is holding back Trade Readiness for ${ticker}?`);
  } else {
    prompts.push(`Why is ${ticker} in Monitor right now?`);
  }
  const dissent = dissentingLayerNames(ctx);
  if (dissent.length) {
    prompts.push(`What are ${dissent.join(" and ")} saying about ${ticker}?`);
  } else {
    prompts.push(`What would move ${ticker} from Monitor to Actionable?`);
  }
  prompts.push(`What does layer alignment mean for ${ticker} on this screen?`);
  return prompts.slice(0, MAX_PROMPTS);
}

function blockedPrompts(ctx: AssistantPageContext, ticker: string): string[] {
  const cat = ctx.decision_rationale?.category;
  const prompts: string[] = [`Why is ${ticker} Blocked on this screen?`];
  if (cat === "risk_reward") {
    prompts.push(`Explain the risk/reward gate for ${ticker}.`);
  } else if (cat === "data_insufficient") {
    prompts.push(`What data is missing before ${ticker} can be evaluated?`);
  } else {
    prompts.push(`Which gate is the main blocker for ${ticker}?`);
  }
  prompts.push(`What would have to change for ${ticker} to reach Monitor?`);
  return prompts.slice(0, MAX_PROMPTS);
}

function actionablePrompts(ctx: AssistantPageContext, ticker: string): string[] {
  const align = ctx.layer_alignment_pct;
  const prompts: string[] = [
    `What is supporting the ${ticker} Decision on this screen?`,
    typeof align === "number"
      ? `What does ${align}% layer alignment mean for ${ticker}?`
      : `How should I read six-layer agreement for ${ticker}?`
  ];
  if (typeof ctx.trade_readiness === "number") {
    prompts.push(`How should I read Trade Readiness (${ctx.trade_readiness}) for ${ticker}?`);
  } else {
    prompts.push(`What is Trade Readiness measuring for ${ticker}?`);
  }
  return prompts.slice(0, MAX_PROMPTS);
}

function signalsLoadingPrompts(ctx: AssistantPageContext, ticker: string): string[] {
  return [
    `What will the Decision line show for ${ticker} once analysis loads?`,
    `How does ${ctx.trading_mode === "day" ? "Day" : "Swing"} mode evaluation work for ${ticker}?`,
    `What do the six layers measure for ${ticker}?`
  ];
}

function scannerPrompts(ctx: AssistantPageContext): string[] {
  const focus = ctx.scanner_focus === "day" ? "Day" : ctx.scanner_focus === "swing" ? "Swing" : "Swing and Day";
  const prompts: string[] = [
    `What should I look for in the top ${focus} setups on this scanner?`,
    ctx.market_open === false
      ? "Why might setups look different when the market is closed?"
      : "How do gap leaders relate to ranked setups here?"
  ];
  const top = ctx.top_setups?.[0];
  if (top?.symbol) {
    prompts.unshift(`What stands out about ${top.symbol.toUpperCase()} in this scanner list?`);
  } else if ((ctx.gap_with_catalyst_count ?? 0) > 0) {
    prompts.unshift("How should I read gap rows that have a catalyst?");
  }
  return prompts.slice(0, MAX_PROMPTS);
}

function marketingPrompts(ctx: AssistantPageContext): string[] {
  const base = [
    "What is STOCVEST?",
    "What are the pricing plans?",
    "How is STOCVEST different from alert services?",
    "What happens in my first 5 minutes after signup?"
  ];
  if (ctx.page === "marketing/home") {
    return [
      "How does the homepage stock preview work?",
      ...base
    ].slice(0, 4);
  }
  if (ctx.page === "marketing/performance") {
    return [
      "How does STOCVEST measure historical signal accuracy?",
      "What is the difference between Swing and Day validation?",
      ...base
    ].slice(0, 4);
  }
  return base;
}

function dashboardPrompts(ctx: AssistantPageContext): string[] {
  const swing = ctx.swing_desk_posture;
  const day = ctx.day_desk_posture;
  if (swing && day) {
    return [
      swing === "suppressed"
        ? "Why is the Swing desk suppressed right now?"
        : "What is the Swing desk showing today?",
      day.startsWith("suppressed")
        ? "Why is the Day desk quiet right now?"
        : "What is the Day desk showing today?",
      "How do Swing and Day desks stay independent?"
    ];
  }
  const top = ctx.top_setups?.[0]?.symbol;
  if (top) {
    return [
      `What stands out about ${top.toUpperCase()} on my dashboard?`,
      "Why might one desk be active while the other is suppressed?",
      "How should I read Market Pulse before acting?"
    ];
  }
  return [
    "What is system posture telling me today?",
    "When do swing setups re-engage?",
    "How do I use the dashboard without overtrading?"
  ];
}

function pageOnlyPrompts(page: string): string[] | null {
  const map: Record<string, string[]> = {
    "dashboard/watchlists": [
      "How does watchlist maturation work?",
      "When are symbols evaluated on my watchlist?",
      "What do alignment bands on the watchlist mean?"
    ],
    "dashboard/journal": [
      "How should I tag journal entries by mode?",
      "What metrics does the journal surface?",
      "How is journal data kept separate for Swing vs Day?"
    ],
    "dashboard/performance": [
      "How do I read my performance on this page?",
      "What is directional accuracy vs P&L?",
      "How are Swing and Day results kept separate?"
    ],
    "dashboard/setup-outcomes": [
      "What is a setup outcome on my watchlist?",
      "How are Swing and Day outcomes separated?",
      "Why might a setup show no edge?"
    ],
    "dashboard/setup-evolution": [
      "What does setup evolution track?",
      "How is this different from live signals?",
      "Which mode am I viewing on this page?"
    ],
    "dashboard/portfolio": [
      "How does STOCVEST read my positions?",
      "Why are positions tagged by trading mode?",
      "What can I learn without trade advice?"
    ],
    "dashboard/settings": [
      "What settings affect alerts and notifications?",
      "Where do I manage my account?",
      "What is included in each subscription tier?"
    ],
    "dashboard/earnings": [
      "How does the earnings calendar affect context?",
      "What should I watch before a report?",
      "Does earnings data authorize a trade?"
    ],
    "dashboard/futures": [
      "How does futures context relate to equities?",
      "What is this panel for?",
      "Does this change my stock Decision?"
    ],
    "dashboard/options": [
      "How should I read options context here?",
      "Does this panel give trade signals?",
      "How does this relate to the six layers?"
    ],
    "dashboard/crypto": [
      "What crypto context does STOCVEST show?",
      "Is crypto evaluation the same as equities?",
      "How should I use this panel?"
    ],
    "dashboard/legal": [
      "What legal agreements apply to my account?",
      "Where is the risk disclosure?",
      "What does not investment advice mean here?"
    ],
    "dashboard/admin/historical-validation": [
      "How do I read stratified accuracy buckets?",
      "What horizon is this summary using?",
      "How is this different from setup outcomes?"
    ]
  };
  return map[page] ?? null;
}

function historyPrompts(ctx: AssistantPageContext): string[] {
  const ticker = sym(ctx);
  if (ticker) {
    return [
      `How do I read past signal states for ${ticker}?`,
      `What does Alignment mean in Signal State History for ${ticker}?`,
      "How is Signal bias different from a trade recommendation?"
    ];
  }
  return [
    "How do I read Signal State History?",
    "What does Alignment mean in past states?",
    "How is Signal bias different from a trade recommendation?"
  ];
}

/** Context-aware suggested questions shown above the composer. */
export function buildContextualQuickPrompts(
  ctx: AssistantPageContext | null,
  isAuthenticated: boolean
): string[] {
  if (!ctx) {
    if (!isAuthenticated) {
      return marketingPrompts({ page: "marketing/home", session_mode: "public" });
    }
    return [
      "What is STOCVEST?",
      "How do I read a signal Decision?",
      "What's the difference between Monitor and Blocked?"
    ];
  }

  if (ctx.session_mode === "public" || ctx.page.startsWith("marketing/")) {
    return marketingPrompts(ctx);
  }

  const pageOnly = pageOnlyPrompts(ctx.page);
  if (pageOnly) return pageOnly;

  if (ctx.page === "dashboard") {
    return dashboardPrompts(ctx);
  }

  if (ctx.page === "signals/history") {
    return historyPrompts(ctx);
  }

  if (ctx.page === "dashboard/scanner" || ctx.page.includes("scanner")) {
    return scannerPrompts(ctx);
  }

  const ticker = sym(ctx);
  if (ctx.analysis_status === "loading" || ctx.analysis_status === "insufficient_data") {
    return ticker ? signalsLoadingPrompts(ctx, ticker) : ["What appears on this screen after you enter a symbol?"];
  }

  if (!ticker) {
    const modeLabel = ctx.trading_mode === "day" ? "Day" : "Swing";
    return [
      `What should I look at first on this ${modeLabel} Signals screen?`,
      "How do Swing and Day evaluation differ on this page?",
      "What does Monitor vs Blocked mean?"
    ];
  }

  const state: AssistantDecisionState | undefined = ctx.decision_state;
  if (state === "monitor") return monitorPrompts(ctx, ticker);
  if (state === "blocked") return blockedPrompts(ctx, ticker);
  if (state === "actionable") return actionablePrompts(ctx, ticker);

  const modeLabel = ctx.trading_mode === "day" ? "Day" : "Swing";
  return [
    `What is STOCVEST evaluating for ${ticker} in ${modeLabel} mode?`,
    `What do the layer dots mean for ${ticker}?`,
    "How is Signal bias different from a trade recommendation?"
  ];
}

export type AssistantEmptyStateCopy = {
  title: string;
  subtitle: string;
};

/** Empty-state headline + helper line tailored to the active screen. */
export function buildContextualEmptyState(
  ctx: AssistantPageContext | null,
  isAuthenticated: boolean
): AssistantEmptyStateCopy {
  if (!ctx) {
    if (!isAuthenticated) {
      return {
        title: "Ask about STOCVEST — product, pricing, and how we think.",
        subtitle:
          "I explain the framework, plans, and terms like R/R. I never recommend stocks, entries, or predict prices."
      };
    }
    return {
      title: "Ask about STOCVEST's analysis or anything on screen.",
      subtitle: "I explain product behavior and what you see. I do not give trading advice or price targets."
    };
  }

  if (ctx.session_mode === "public" || ctx.page.startsWith("marketing/")) {
    return {
      title: "Ask about STOCVEST — product, pricing, and how we think.",
      subtitle:
        "Pricing, six layers, Swing vs Day, and signup flow are fair game. Per-stock verdicts require a free account inside the app."
    };
  }

  const pageOnly = pageOnlyPrompts(ctx.page);
  if (pageOnly) {
    return {
      title: "I can explain what this screen is showing and how to use it.",
      subtitle: "Ask about the workflow on this page — not whether to enter a trade."
    };
  }

  if (ctx.page === "dashboard") {
    return {
      title: "I can explain both desks — Swing and Day — as separate postures.",
      subtitle: "Ask why a desk is suppressed, what leaders mean, or how to read today's tape."
    };
  }

  const ticker = sym(ctx);
  const mode = ctx.trading_mode === "day" ? "Day" : "Swing";

  if (ctx.page === "dashboard/scanner" || ctx.page.includes("scanner")) {
    return {
      title: "I can explain this scanner view — gaps, setups, and how rows are ranked.",
      subtitle: "Ask about a symbol you see, catalyst gaps, or why a setup is highlighted. No trade calls."
    };
  }

  if (ctx.page === "signals/history") {
    return {
      title: ticker
        ? `I can explain past signal states for ${ticker}.`
        : "I can explain how Signal State History is read.",
      subtitle: "Ask about alignment, outcomes, or bias labels — not whether to enter a trade."
    };
  }

  if (ctx.analysis_status === "loading" && ticker) {
    return {
      title: `${ticker} is selected — analysis is still loading on this screen.`,
      subtitle: `I can explain what will appear for ${mode} mode and how to read the Decision once layers populate.`
    };
  }

  if (ticker && ctx.decision_state) {
    const stateLabel =
      ctx.decision_state === "actionable"
        ? "Actionable"
        : ctx.decision_state === "blocked"
          ? "Blocked"
          : "Monitor";
    const rationale = ctx.decision_rationale?.text?.trim();
    return {
      title: `You're on ${ticker} · ${stateLabel} (${mode}). I can explain what's driving this Decision.`,
      subtitle: rationale
        ? `On screen: ${rationale}`
        : "Ask about layers, alignment, risk/reward, or what would change this Decision."
    };
  }

  if (ticker) {
    return {
      title: `You're viewing ${ticker} in ${mode} mode. I can explain the layers and Decision line.`,
      subtitle: "Pick a suggested question below or type your own — I explain analysis, not entries."
    };
  }

  return {
    title: "I can explain what's driving this Decision and how to read the layers.",
    subtitle: "I explain analysis and product behavior. I never give trading advice or predict prices."
  };
}
