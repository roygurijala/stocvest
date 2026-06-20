import type { LivePlanAssessment, TrackedPlan, TrackedPlanBias } from "@/lib/trade-plan/types";

export type ThesisStatus = "valid" | "weakened" | "invalid";
export type TriggerStatus = "enter_now" | "wait_for_entry" | "not_available";

export type TriggerDisplay = {
  status: TriggerStatus;
  label: string;
  hint: string;
};

export type ThesisDisplay = {
  status: ThesisStatus;
  label: string;
  hint: string;
};

export type LiveVsPlanDiff = {
  thesis: ThesisDisplay;
  trigger: TriggerDisplay;
  planLines: string[];
  liveLines: string[];
  managementLines: string[];
};

function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

function fmtZone(lo: number, hi: number): string {
  return `${fmtUsd(lo)}–${fmtUsd(hi)}`;
}

function biasDirection(bias: TrackedPlanBias): "long" | "short" | "neutral" {
  if (bias === "Bullish") return "long";
  if (bias === "Bearish") return "short";
  return "neutral";
}

export function resolveThesisDisplay(plan: TrackedPlan, live: LivePlanAssessment): ThesisDisplay {
  if (live.isInsufficient) {
    return {
      status: "invalid",
      label: "Thesis unavailable",
      hint: "Live data insufficient — your frozen plan still applies to your open trade."
    };
  }
  if (live.decisionState === "blocked") {
    return {
      status: "invalid",
      label: "Thesis blocked",
      hint: "Desk gates no longer support this direction — review whether your plan still fits."
    };
  }
  if (live.setupBias !== plan.bias && live.setupBias !== "Neutral" && plan.bias !== "Neutral") {
    return {
      status: "invalid",
      label: "Thesis flipped",
      hint: `Plan was ${plan.bias}; live read is ${live.setupBias}.`
    };
  }
  const aligned = live.layersAligned;
  const total = live.layersTotal;
  const planAligned = plan.layersAligned;
  if (
    aligned != null &&
    total != null &&
    planAligned != null &&
    aligned < planAligned - 1
  ) {
    return {
      status: "weakened",
      label: "Thesis weakened",
      hint: `Layer alignment fell from ${planAligned}/${plan.layersTotal ?? total} to ${aligned}/${total}.`
    };
  }
  return {
    status: "valid",
    label: "Thesis intact",
    hint: `${plan.bias} · ${plan.layersAligned != null && plan.layersTotal != null ? `${plan.layersAligned}/${plan.layersTotal} layers at commit` : "structure at commit"}`
  };
}

export function resolveTriggerDisplay(live: LivePlanAssessment, deskMinRr?: number | null): TriggerDisplay {
  if (live.isInsufficient) {
    return {
      status: "not_available",
      label: "Trigger unknown",
      hint: "Cannot assess entry timing without a live composite."
    };
  }
  if (live.entryZoneQuality === "no_clean_entry") {
    return {
      status: "wait_for_entry",
      label: "Wait — no clean entry band",
      hint: "Stop and target are too tight to define a valid entry zone at current structure."
    };
  }
  if (live.executionActionable === true || (live.decisionState === "actionable" && live.inEntryZone)) {
    return {
      status: "enter_now",
      label: "Enter now",
      hint: "Price is in the entry zone and desk gates clear for a new entry."
    };
  }
  if (live.inEntryZone) {
    const gate = deskMinRr != null ? `${deskMinRr.toFixed(1)}:1` : "desk minimum";
    return {
      status: "wait_for_entry",
      label: "In zone — gates not cleared",
      hint: `Inside entry zone but R/R or other gates do not clear ${gate} from current price.`
    };
  }
  const rr =
    live.currentRr != null && Number.isFinite(live.currentRr) ? `${live.currentRr.toFixed(1)}:1` : "n/a";
  return {
    status: "wait_for_entry",
    label: "Wait for entry zone",
    hint: `Price is outside the live entry band. R/R from current: ${rr}.`
  };
}

export function resolveLiveVsPlanDiff(
  plan: TrackedPlan,
  live: LivePlanAssessment,
  deskMinRr?: number | null
): LiveVsPlanDiff {
  const lv = plan.levels;
  const thesis = resolveThesisDisplay(plan, live);
  const trigger = resolveTriggerDisplay(live, deskMinRr ?? plan.deskMinRr);

  const committedEt = formatCommittedEt(plan.committedAt);
  const planLines = [
    `Issued ${committedEt}`,
    `Entry zone ${fmtZone(lv.entryLow, lv.entryHigh)}`,
    `Stop ${fmtUsd(lv.stop)} · T1 ${fmtUsd(lv.target1)}${lv.target2 != null ? ` · T2 ${fmtUsd(lv.target2)}` : ""}`,
    `Price at commit ${fmtUsd(lv.priceAtCommit)}${lv.riskRewardAtCommit != null ? ` · R/R ${lv.riskRewardAtCommit.toFixed(1)}:1` : ""}`
  ];

  const liveLines: string[] = [];
  if (live.currentPrice != null) {
    liveLines.push(`Current ${fmtUsd(live.currentPrice)}`);
  }
  liveLines.push(trigger.label);
  if (live.currentRr != null) {
    liveLines.push(`R/R from current ${live.currentRr.toFixed(1)}:1`);
  }
  if (live.entryZoneQuality) {
    liveLines.push(`Entry zone quality: ${live.entryZoneQuality.replace(/_/g, " ")}`);
  }

  const managementLines: string[] = [];
  if (trigger.status === "enter_now") {
    managementLines.push("Live read: new entries are acceptable at current price.");
  } else if (trigger.status === "wait_for_entry") {
    managementLines.push(
      "Live read: do not add at current price — wait for the entry zone or a fresh plan."
    );
  }
  if (thesis.status === "valid") {
    managementLines.push("Your frozen plan levels are unchanged — manage your trade against the plan you tracked.");
  } else if (thesis.status === "weakened") {
    managementLines.push("Thesis weakened — consider tightening risk; plan levels are not auto-updated.");
  } else {
    managementLines.push("Thesis may be invalidated — review open risk against your frozen stop/target.");
  }

  const dir = biasDirection(plan.bias);
  if (live.currentPrice != null && dir !== "neutral") {
    if (dir === "long" && live.currentPrice <= lv.stop) {
      managementLines.push("Price is at or below your plan stop.");
    }
    if (dir === "short" && live.currentPrice >= lv.stop) {
      managementLines.push("Price is at or above your plan stop.");
    }
  }

  return { thesis, trigger, planLines, liveLines, managementLines };
}

export function formatCommittedEt(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-US", {
      timeZone: "America/New_York",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true
    }) + " ET";
  } catch {
    return iso;
  }
}

export function buildLiveAssessmentFromDeepDive(input: {
  currentPrice: number | null;
  setupBias: TrackedPlanBias;
  decisionState: "actionable" | "monitor" | "blocked" | null;
  executionActionable?: boolean | null;
  entryZoneQuality?: string | null;
  entryLow?: number | null;
  entryHigh?: number | null;
  currentRr?: number | null;
  isInsufficient: boolean;
  layersAligned?: number | null;
  layersTotal?: number | null;
}): LivePlanAssessment {
  const lo = input.entryLow;
  const hi = input.entryHigh;
  const price = input.currentPrice;
  const inZone =
    price != null &&
    lo != null &&
    hi != null &&
    Number.isFinite(lo) &&
    Number.isFinite(hi) &&
    price >= lo &&
    price <= hi;

  return {
    currentPrice: price,
    setupBias: input.setupBias,
    decisionState: input.decisionState,
    executionActionable: input.executionActionable ?? null,
    entryZoneQuality: input.entryZoneQuality ?? null,
    inEntryZone: inZone,
    currentRr: input.currentRr ?? null,
    isInsufficient: input.isInsufficient,
    layersAligned: input.layersAligned ?? null,
    layersTotal: input.layersTotal ?? null
  };
}
