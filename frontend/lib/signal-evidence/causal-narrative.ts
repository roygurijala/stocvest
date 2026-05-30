/**
 * Causal signal narrative — why each layer reads the way it does.
 * Informational only; does not change gating or scores.
 */

import { signalLayerDisplayName } from "@/lib/signals/layer-display-names";
import {
  layerPolarity,
  type SignalsLayerPolarity,
  type SignalsLayerRowInput,
  type SignalsSetupBias
} from "@/lib/signals-page-present";

export type CausalLayerRole = "root_cause" | "amplifier" | "symptom" | "gate" | "support" | "context";

export type CausalLayerNote = {
  layer: string;
  name: string;
  polarity: SignalsLayerPolarity | "unavailable";
  role: CausalLayerRole;
  headline: string;
  because: string;
  causedBy: string[];
};

export type CausalNarrative = {
  informationalOnly: true;
  setupBias: "bullish" | "bearish" | "neutral";
  summary: string;
  chain: CausalLayerNote[];
  layerNotes: Record<string, CausalLayerNote>;
  chainLabel: string;
};

const CAUSAL_LAYER_ORDER = [
  "macro",
  "geopolitical",
  "internals",
  "sector",
  "news",
  "technical"
] as const;

const ENVIRONMENT_LAYERS = new Set(["macro", "geopolitical", "internals"]);

const GENERIC_EXPLANATION_RE =
  /shows the most recent close-state reading|signals align with upside|signals show downside pressure|is mixed without strong direction|data is unavailable right now|contributes [+-]?\d/i;

const BANNED_WORDS_RE = /\b(buy|sell|consider|watch closely|near miss)\b/i;

function setupBiasFromSummary(summary: string): CausalNarrative["setupBias"] {
  const v = summary.trim().toLowerCase();
  if (v === "bullish") return "bullish";
  if (v === "bearish") return "bearish";
  return "neutral";
}

function biasToSignalsBias(bias: CausalNarrative["setupBias"]): SignalsSetupBias {
  if (bias === "bullish") return "Bullish";
  if (bias === "bearish") return "Bearish";
  return "Neutral";
}

function substantiveExplanation(text: string): boolean {
  const raw = text.trim();
  if (raw.length < 12) return false;
  if (GENERIC_EXPLANATION_RE.test(raw)) return false;
  return true;
}

function clampText(text: string, limit = 220): string {
  const s = text.replace(/\s+/g, " ").trim();
  if (s.length <= limit) return s;
  return `${s.slice(0, limit - 1).trim()}…`;
}

function upstreamForLayer(key: string, blockingKeys: string[]): string[] {
  const idx = CAUSAL_LAYER_ORDER.indexOf(key as (typeof CAUSAL_LAYER_ORDER)[number]);
  if (idx < 0) return [];
  const upstream: string[] = [];
  for (const other of blockingKeys) {
    if (other === key) continue;
    const oidx = CAUSAL_LAYER_ORDER.indexOf(other as (typeof CAUSAL_LAYER_ORDER)[number]);
    if (oidx >= 0 && oidx < idx && (ENVIRONMENT_LAYERS.has(other) || other === "internals" || other === "sector")) {
      upstream.push(other);
    }
  }
  return upstream.slice(0, 2);
}

function roleForLayer(
  key: string,
  polarity: SignalsLayerPolarity | "unavailable",
  upstream: string[]
): CausalLayerRole {
  if (polarity === "supportive") return "support";
  if (polarity === "neutral" || polarity === "unavailable") return "context";
  if (ENVIRONMENT_LAYERS.has(key) && upstream.length === 0) return "root_cause";
  if (key === "technical" && upstream.length > 0) return "symptom";
  if ((key === "news" || key === "sector") && upstream.length > 0) return "symptom";
  if (upstream.length > 0) return "amplifier";
  return "gate";
}

function defaultBecause(
  key: string,
  polarity: SignalsLayerPolarity | "unavailable",
  upstream: string[]
): string {
  const name = signalLayerDisplayName(key) ?? key;
  const upNames = upstream.map((u) => signalLayerDisplayName(u) ?? u);
  if (polarity === "supportive") {
    if (key === "technical") return "Structure and momentum line up with the setup bias.";
    if (key === "internals") return "Participation breadth supports this direction on the tape.";
    if (key === "sector") return "Sector leadership is confirming versus the broader market.";
    if (key === "macro") return "Macro backdrop is not fighting the setup bias.";
    return `${name} is aligned with the setup bias.`;
  }
  if (polarity === "blocking") {
    if (upstream.length > 0) {
      const chain = upNames.join(" and ");
      if (key === "technical") return `Price structure has not cleared while ${chain} remain headwinds.`;
      if (key === "sector") return `Sector participation is weak while ${chain} keep risk appetite muted.`;
      if (key === "news") return `No catalyst is supporting the bias while ${chain} stay unfavorable.`;
      return `${name} opposes the setup while ${chain} already weigh on alignment.`;
    }
    if (key === "macro") return "Macro regime and tape tone are working against this setup direction.";
    if (key === "internals") return "Breadth and participation are not confirming — risk appetite is thin.";
    if (key === "sector") return "Sector is not leading; relative strength does not support the bias.";
    if (key === "news") return "Headline flow offers no catalyst support for this direction.";
    if (key === "technical") return "Trend and structure have not confirmed — continuation gates stay open.";
    return `${name} opposes the setup bias.`;
  }
  if (polarity === "mixed") {
    if (key === "sector") return "Sector participation is mixed — no clear leadership versus SPY.";
    if (key === "internals") return "Market internals are split — tape is not giving a clean confirmation.";
    return `${name} is mixed and does not confirm the bias.`;
  }
  return "Coverage is unavailable — this layer is not factored into the read.";
}

function headlineForNote(key: string, polarity: SignalsLayerPolarity | "unavailable", role: CausalLayerRole): string {
  const name = signalLayerDisplayName(key) ?? key;
  if (role === "root_cause") return `${name} is the main environmental headwind`;
  if (role === "amplifier") return `${name} is not confirming while broader conditions stay muted`;
  if (role === "symptom") return `${name} has not cleared while upstream conditions stay unfavorable`;
  if (role === "gate") return `${name} is the local gate still open`;
  if (polarity === "supportive") return `${name} supports the setup bias`;
  return `${name} — background only`;
}

function buildLayerNote(
  row: SignalsLayerRowInput,
  bias: SignalsSetupBias,
  blockingKeys: string[]
): CausalLayerNote | null {
  const key = row.key.trim().toLowerCase();
  if (row.status === "Unavailable" && !substantiveExplanation(row.explanation)) {
    return null;
  }
  const polarity: SignalsLayerPolarity = layerPolarity(row, bias);
  if (polarity === "neutral" && !substantiveExplanation(row.explanation)) {
    return null;
  }
  const upstream = upstreamForLayer(key, blockingKeys);
  const role = roleForLayer(key, polarity, upstream);
  const because = substantiveExplanation(row.explanation)
    ? clampText(row.explanation, 200)
    : defaultBecause(key, polarity, upstream);
  return {
    layer: key,
    name: row.name || signalLayerDisplayName(key) || key,
    polarity,
    role,
    headline: headlineForNote(key, polarity, role),
    because,
    causedBy: upstream
  };
}

function buildSummary(chain: CausalLayerNote[], bias: CausalNarrative["setupBias"]): string {
  if (chain.length === 0) {
    if (bias === "neutral") return "Layers are mixed — no single direction dominates the read.";
    return "No layer is acting as a strong headwind — execution gates still apply separately.";
  }
  if (chain.length === 1) {
    return `${chain[0]!.headline}. Other layers are not the primary blocker.`;
  }
  const a = chain[0]!.headline;
  const b = chain[1]!.headline;
  const bLower = b.charAt(0).toLowerCase() + b.slice(1);
  return `${a}; ${bLower}.`;
}

export function buildCausalNarrativeFromRows(input: {
  signalSummary: string;
  rows: SignalsLayerRowInput[];
  executionNote?: string | null;
}): CausalNarrative {
  const setupBias = setupBiasFromSummary(input.signalSummary);
  const signalsBias = biasToSignalsBias(setupBias);

  const blockingKeys: string[] = [];
  for (const key of CAUSAL_LAYER_ORDER) {
    const row = input.rows.find((r) => r.key === key);
    if (!row) continue;
    const pol = layerPolarity(row, signalsBias);
    if (pol === "blocking" || pol === "mixed") blockingKeys.push(key);
  }

  const layerNotes: Record<string, CausalLayerNote> = {};
  for (const key of CAUSAL_LAYER_ORDER) {
    const row = input.rows.find((r) => r.key === key);
    if (!row) continue;
    const note = buildLayerNote(row, signalsBias, blockingKeys);
    if (note) layerNotes[key] = note;
  }

  const chain: CausalLayerNote[] = [];
  for (const key of CAUSAL_LAYER_ORDER) {
    const note = layerNotes[key];
    if (note && (note.polarity === "blocking" || note.polarity === "mixed")) {
      chain.push(note);
    }
  }
  const chainTrimmed = chain.slice(0, 4);

  let summary = buildSummary(chainTrimmed, setupBias);
  const ex = input.executionNote?.trim();
  if (ex && !summary.toLowerCase().includes(ex.toLowerCase().slice(0, 24))) {
    summary = `${summary} Execution: ${clampText(ex, 160)}`;
  }
  summary = clampText(summary, 320);

  const chainLabel = chainTrimmed.map((n) => n.name).join(" → ");
  if (BANNED_WORDS_RE.test(`${summary} ${chainLabel}`)) {
    summary = "Layer headwinds are documented on the card — see the breakdown below.";
  }

  return {
    informationalOnly: true,
    setupBias,
    summary,
    chain: chainTrimmed,
    layerNotes,
    chainLabel
  };
}

export function parseCausalNarrativeFromApi(raw: unknown): CausalNarrative | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const summary = typeof o.summary === "string" ? o.summary.trim() : "";
  if (!summary) return null;

  const setupBiasRaw = String(o.setup_bias ?? o.setupBias ?? "neutral").toLowerCase();
  const setupBias: CausalNarrative["setupBias"] =
    setupBiasRaw === "bullish" || setupBiasRaw === "bearish" ? setupBiasRaw : "neutral";

  const parseNote = (item: unknown): CausalLayerNote | null => {
    if (!item || typeof item !== "object") return null;
    const n = item as Record<string, unknown>;
    const layer = String(n.layer ?? "").trim().toLowerCase();
    if (!layer) return null;
    const because = typeof n.because === "string" ? n.because.trim() : "";
    if (!because) return null;
    const causedBy = Array.isArray(n.caused_by)
      ? (n.caused_by as unknown[]).map((x) => String(x).trim().toLowerCase()).filter(Boolean)
      : Array.isArray(n.causedBy)
        ? (n.causedBy as unknown[]).map((x) => String(x).trim().toLowerCase()).filter(Boolean)
        : [];
    return {
      layer,
      name: String(n.name ?? signalLayerDisplayName(layer) ?? layer),
      polarity: (String(n.polarity ?? "neutral") as CausalLayerNote["polarity"]) || "neutral",
      role: (String(n.role ?? "context") as CausalLayerRole) || "context",
        headline: String(n.headline ?? "").trim() || (signalLayerDisplayName(layer) ?? layer),
      because,
      causedBy
    };
  };

  const chainRaw = Array.isArray(o.chain) ? o.chain : [];
  const chain = chainRaw.map(parseNote).filter((x): x is CausalLayerNote => x != null);

  const layerNotes: Record<string, CausalLayerNote> = {};
  const notesRaw = o.layer_notes ?? o.layerNotes;
  if (notesRaw && typeof notesRaw === "object" && !Array.isArray(notesRaw)) {
    for (const [k, v] of Object.entries(notesRaw as Record<string, unknown>)) {
      const note = parseNote(v);
      if (note) layerNotes[k] = note;
    }
  }

  return {
    informationalOnly: true,
    setupBias,
    summary,
    chain,
    layerNotes,
    chainLabel: typeof o.chain_label === "string" ? o.chain_label : typeof o.chainLabel === "string" ? o.chainLabel : ""
  };
}

/** Prefer API narrative when present; else build from layer rows. */
export function resolveCausalNarrative(input: {
  apiPayload?: unknown;
  signalSummary: string;
  rows: SignalsLayerRowInput[];
  executionNote?: string | null;
}): CausalNarrative {
  const fromApi = parseCausalNarrativeFromApi(input.apiPayload);
  if (fromApi) return fromApi;
  return buildCausalNarrativeFromRows({
    signalSummary: input.signalSummary,
    rows: input.rows,
    executionNote: input.executionNote
  });
}

export function causalBulletsForWhyNot(narrative: CausalNarrative, max = 4): string[] {
  const out: string[] = [narrative.summary];
  for (const note of narrative.chain) {
    if (out.length >= max) break;
    const tag = note.causedBy.length
      ? `${note.name}: ${note.because} (follows ${note.causedBy.map((k) => signalLayerDisplayName(k) ?? k).join(", ")})`
      : `${note.name}: ${note.because}`;
    if (!out.some((b) => b.includes(note.name))) out.push(tag);
  }
  return out.slice(0, max);
}

export function causalLineForLayerRow(
  row: SignalsLayerRowInput,
  narrative: CausalNarrative | null,
  bias: SignalsSetupBias
): string | null {
  if (!narrative) return null;
  const note = narrative.layerNotes[row.key];
  if (note) return note.because;
  if (row.status === "Unavailable") return null;
  const pol: SignalsLayerPolarity = layerPolarity(row, bias);
  if (pol === "neutral") return null;
  return null;
}
