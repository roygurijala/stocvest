"use client";

import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { formatScenarioDollars } from "@/lib/scenario/compute";
import {
  buildScenarioRrFixGuidance,
  type ScenarioRrFixGuidance,
  type ScenarioRrLeverQuality
} from "@/lib/scenario/scenario-rr-fix-guidance";
import {
  buildScenarioVariantCatalog,
  describeInvalidScenarioSelection,
  explainScenarioImpact,
  formatScenarioRatio,
  remainingBlockersAfterScenarioRr,
  resolveScenarioLevels,
  scenarioClearsRrGate,
  scenarioExecutionSummary,
  scenarioRrBarFills,
  SCENARIO_RR_MIN,
  scenarioRrTone,
  type ScenarioEntryStyle,
  type ScenarioGeometryBundle,
  type ScenarioPresetId,
  type ScenarioSelection,
  type ScenarioStopStrategy,
  type ScenarioTargetChoice,
  type ScenarioVariantCatalog
} from "@/lib/scenario/scenario-variants";
import type { TradeDecision } from "@/lib/signal-evidence/trade-decision";
import { borderRadius, spacing } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  systemDecision: TradeDecision;
  geometryBundle: ScenarioGeometryBundle;
};

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  testId
}: {
  label: string;
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
  testId: string;
}) {
  const { colors } = useTheme();
  return (
    <div>
      <p className="m-0 text-[10px] font-semibold uppercase tracking-wide" style={{ color: colors.textMuted }}>
        {label}
      </p>
      <div className="mt-1 flex flex-wrap gap-1" role="group" aria-label={label} data-testid={testId}>
        {options.map((opt) => {
          const active = opt.id === value;
          return (
            <button
              key={opt.id}
              type="button"
              className="rounded-md px-2 py-1 text-xs font-semibold transition"
              style={{
                border: `1px solid ${active ? colors.accent : colors.border}`,
                background: active ? `color-mix(in srgb, ${colors.accent} 14%, transparent)` : "transparent",
                color: active ? colors.accent : colors.textMuted,
                cursor: "pointer"
              }}
              aria-pressed={active}
              onClick={() => onChange(opt.id)}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function qualityLabel(q: ScenarioRrLeverQuality): string {
  if (q === "best") return "Best";
  if (q === "medium") return "Medium";
  return "Risky";
}

function qualityColor(q: ScenarioRrLeverQuality, colors: ReturnType<typeof useTheme>["colors"]): string {
  if (q === "best") return colors.bullish;
  if (q === "medium") return colors.caution;
  return colors.bearish;
}

function RrFixGuidancePanel({ guidance, testId }: { guidance: ScenarioRrFixGuidance; testId: string }) {
  const { colors } = useTheme();
  return (
    <div
      className="mt-2 rounded-md p-2.5"
      data-testid={testId}
      style={{
        background: `color-mix(in srgb, ${colors.caution} 8%, transparent)`,
        border: `1px solid color-mix(in srgb, ${colors.caution} 30%, ${colors.border})`,
        borderRadius: borderRadius.md
      }}
    >
      <p className="m-0 text-xs font-bold uppercase tracking-wide" style={{ color: colors.textMuted }}>
        R/R fix guidance
      </p>
      <p className="m-0 mt-2 text-xs leading-relaxed" style={{ color: colors.text }} data-testid={`${testId}-diagnosis`}>
        {guidance.diagnosis}
      </p>
      <p className="m-0 mt-2 text-xs tabular-nums" style={{ color: colors.textMuted }}>
        Risk {formatScenarioDollars(guidance.riskPerShare)} · Reward {formatScenarioDollars(guidance.rewardPerShare)} ·
        need {formatScenarioDollars(guidance.requiredReward)} reward for {guidance.minRr.toFixed(1)} : 1
      </p>
      <p className="m-0 mt-2 text-xs font-semibold" style={{ color: colors.text }}>
        To reach {guidance.minRr.toFixed(1)} : 1 (change one lever):
      </p>
      <ul className="m-0 mt-2 list-none space-y-2.5 p-0" data-testid={`${testId}-levers`}>
        {guidance.levers.map((lever) => (
          <li key={lever.id} data-testid={`${testId}-lever-${lever.id}`}>
            <p className="m-0 text-xs font-semibold" style={{ color: qualityColor(lever.quality, colors) }}>
              {qualityLabel(lever.quality)} — {lever.label}
            </p>
            <p className="m-0 mt-0.5 text-sm font-semibold tabular-nums" style={{ color: colors.text }}>
              {lever.thresholdText}
            </p>
            <p className="m-0 text-xs leading-relaxed" style={{ color: colors.textMuted }}>
              {lever.detail}
            </p>
            <p className="m-0 text-[10px] tabular-nums" style={{ color: colors.textMuted }}>
              (calc: {lever.calcLine})
            </p>
          </li>
        ))}
      </ul>
      {guidance.warnings.length > 0 ? (
        <ul className="m-0 mt-2 list-none space-y-1 p-0" data-testid={`${testId}-warnings`}>
          {guidance.warnings.map((w) => (
            <li key={w} className="text-xs leading-relaxed" style={{ color: colors.caution }}>
              {w}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function RrBar({ riskReward }: { riskReward: number }) {
  const { colors } = useTheme();
  const { risk, reward } = scenarioRrBarFills(riskReward);
  const tone = scenarioRrTone(riskReward);
  const accent =
    tone === "low" ? colors.caution : tone === "ok" ? colors.bullish : colors.bullish;
  return (
    <div className="mt-2 grid gap-1 text-[10px]" data-testid="signals-scenario-rr-bar">
      <div className="flex items-center gap-2">
        <span className="w-12 shrink-0" style={{ color: colors.textMuted }}>
          Risk
        </span>
        <div
          className="h-1.5 flex-1 overflow-hidden rounded-full"
          style={{ background: `color-mix(in srgb, ${colors.border} 80%, transparent)` }}
        >
          <div className="h-full rounded-full" style={{ width: `${risk * 100}%`, background: colors.caution }} />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="w-12 shrink-0" style={{ color: colors.textMuted }}>
          Reward
        </span>
        <div
          className="h-1.5 flex-1 overflow-hidden rounded-full"
          style={{ background: `color-mix(in srgb, ${colors.border} 80%, transparent)` }}
        >
          <div className="h-full rounded-full" style={{ width: `${reward * 100}%`, background: accent }} />
        </div>
      </div>
    </div>
  );
}

export function SignalsScenarioAdjust({ systemDecision, geometryBundle }: Props) {
  const { colors } = useTheme();
  const { source: geometrySource, precision, estimationLines } = geometryBundle;
  const catalog = useMemo(
    () => buildScenarioVariantCatalog(geometrySource),
    [geometrySource]
  );
  const [open, setOpen] = useState(
    () =>
      systemDecision.rationale?.category === "risk_reward" ||
      (geometrySource.systemRiskReward != null &&
        Number.isFinite(geometrySource.systemRiskReward) &&
        geometrySource.systemRiskReward < SCENARIO_RR_MIN) ||
      precision === "estimated"
  );
  const [selection, setSelection] = useState<ScenarioSelection | null>(
    () => catalog?.defaultSelection ?? null
  );

  const activeSelection = selection ?? catalog?.defaultSelection ?? null;
  const resolved = useMemo(() => {
    if (!catalog || !activeSelection) return null;
    return resolveScenarioLevels(catalog.source, activeSelection);
  }, [catalog, activeSelection]);

  const system = catalog?.system ?? null;
  const selectionInvalid =
    catalog && activeSelection && !resolved
      ? describeInvalidScenarioSelection(catalog.source, activeSelection)
      : null;
  const clearsRr = resolved ? scenarioClearsRrGate(resolved.riskReward) : false;
  const stillBlocked = remainingBlockersAfterScenarioRr(systemDecision, clearsRr);
  const impact =
    system && resolved ? explainScenarioImpact(system, resolved, activeSelection!) : [];
  const execSummary =
    resolved != null
      ? scenarioExecutionSummary({
          systemDecision,
          scenarioRr: resolved.riskReward,
          scenarioClearsRr: clearsRr
        })
      : null;

  if (!catalog || !system || !activeSelection) return null;

  const systemRr =
    geometrySource.systemRiskReward != null && Number.isFinite(geometrySource.systemRiskReward)
      ? geometrySource.systemRiskReward
      : system.riskReward;
  const showPanel = systemDecision.state !== "actionable" || open;

  const applyPreset = (preset: ScenarioPresetId) => {
    const next = catalog.presets[preset];
    setSelection({ ...next });
    setOpen(true);
  };

  const rrColor = resolved
    ? scenarioRrTone(resolved.riskReward) === "low"
      ? colors.caution
      : colors.bullish
    : colors.caution;

  const systemRrFix =
    systemRr < SCENARIO_RR_MIN
      ? buildScenarioRrFixGuidance(system, geometrySource.direction, geometrySource)
      : null;
  const scenarioRrFix =
    !clearsRr && resolved
      ? buildScenarioRrFixGuidance(resolved, geometrySource.direction, geometrySource)
      : null;
  const showScenarioFixPanel =
    scenarioRrFix != null &&
    (scenarioRrFix.entry !== systemRrFix?.entry ||
      scenarioRrFix.stop !== systemRrFix?.stop ||
      scenarioRrFix.target !== systemRrFix?.target ||
      Math.abs(scenarioRrFix.riskReward - (systemRrFix?.riskReward ?? 0)) > 0.05);

  return (
    <div
      className="mt-3 rounded-lg border p-3"
      style={{ borderColor: colors.border, background: `color-mix(in srgb, ${colors.surface} 92%, ${colors.accent})` }}
      data-testid="signals-scenario-adjust"
    >
      <p className="m-0 text-xs font-semibold" style={{ color: colors.textMuted }}>
        {precision === "validated" ? "Reference scenario (validated)" : "Reference scenario (estimated)"}
      </p>
      <p className="m-0 mt-1 text-sm tabular-nums" style={{ color: colors.text }} data-testid="signals-scenario-system-rr">
        <span aria-hidden>{systemRr < SCENARIO_RR_MIN ? "⚠ " : precision === "validated" ? "✓ " : "≈ "}</span>
        Risk/Reward {formatScenarioRatio(systemRr)}
      </p>
      <p className="m-0 mt-1 text-xs tabular-nums leading-relaxed" style={{ color: colors.textMuted }}>
        Entry {formatScenarioDollars(system.entry)} · Stop {formatScenarioDollars(system.stop)} · Target{" "}
        {formatScenarioDollars(system.target)}
      </p>
      {precision === "estimated" && estimationLines.length > 0 ? (
        <div className="mt-2" data-testid="signals-scenario-estimated">
          <p className="m-0 text-[10px] font-semibold uppercase tracking-wide" style={{ color: colors.caution }}>
            Estimated using
          </p>
          <ul className="m-0 mt-1 list-none space-y-0.5 p-0 text-xs" style={{ color: colors.textMuted }}>
            {estimationLines.map((line) => (
              <li key={line}>· {line}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <RrBar riskReward={system.riskReward} />
      {systemRrFix ? (
        <RrFixGuidancePanel guidance={systemRrFix} testId="signals-scenario-system-rr-guidance" />
      ) : null}

      {showPanel ? (
        <>
          <button
            type="button"
            className="mt-3 inline-flex w-full items-center justify-between gap-2 border-0 bg-transparent p-0 text-left text-sm font-semibold"
            style={{ color: colors.accent, cursor: "pointer" }}
            data-testid="signals-scenario-adjust-toggle"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <span>Adjust scenario</span>
            <ChevronDown
              size={16}
              className="shrink-0 transition-transform"
              style={{ transform: open ? "rotate(180deg)" : undefined }}
              aria-hidden
            />
          </button>

          {open ? (
            <div
              className="mt-3 grid gap-3 border-t pt-3"
              style={{ borderColor: colors.border }}
              data-testid="signals-scenario-adjust-panel"
            >
              <div>
                <p className="m-0 text-[10px] font-semibold uppercase tracking-wide" style={{ color: colors.textMuted }}>
                  Presets
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {(
                    [
                      ["default", "Default"],
                      ["conservative", "Conservative"],
                      ["aggressive", "Aggressive"]
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      className="rounded-md px-2.5 py-1 text-xs font-semibold"
                      style={{
                        border: `1px solid ${activeSelection.preset === id ? colors.accent : colors.border}`,
                        color: activeSelection.preset === id ? colors.accent : colors.textMuted,
                        cursor: "pointer"
                      }}
                      data-testid={`signals-scenario-preset-${id}`}
                      onClick={() => applyPreset(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <Segmented<ScenarioEntryStyle>
                label="Entry style"
                value={activeSelection.entry}
                testId="signals-scenario-entry"
                options={[
                  { id: "mid_zone", label: "Mid-zone" },
                  { id: "aggressive", label: "Aggressive" },
                  { id: "conservative", label: "Conservative" }
                ]}
                onChange={(entry) => setSelection((s) => (s ? { ...s, entry } : s))}
              />
              <Segmented<ScenarioStopStrategy>
                label="Stop strategy"
                value={activeSelection.stop}
                testId="signals-scenario-stop"
                options={[
                  { id: "structural", label: "Structural" },
                  { id: "tight", label: "Tight" },
                  { id: "vwap", label: "VWAP" }
                ]}
                onChange={(stop) => setSelection((s) => (s ? { ...s, stop } : s))}
              />
              <Segmented<ScenarioTargetChoice>
                label="Target"
                value={activeSelection.target}
                testId="signals-scenario-target"
                options={[
                  { id: "t1", label: "T1" },
                  { id: "t2", label: "T2" }
                ]}
                onChange={(target) => setSelection((s) => (s ? { ...s, target } : s))}
              />

              <div
                className="rounded-md p-2.5"
                style={{
                  background: `color-mix(in srgb, ${colors.accent} 8%, transparent)`,
                  borderRadius: borderRadius.md
                }}
              >
                <p className="m-0 text-xs font-semibold uppercase tracking-wide" style={{ color: colors.textMuted }}>
                  Result
                </p>
                {resolved ? (
                  <>
                    <p
                      className="m-0 mt-1 text-sm font-semibold tabular-nums"
                      style={{ color: rrColor }}
                      data-testid="signals-scenario-result-rr"
                    >
                      Risk/Reward {formatScenarioRatio(resolved.riskReward)}
                      {!clearsRr ? " ⚠" : " ✓"}
                    </p>
                    <p className="m-0 mt-1 text-xs tabular-nums" style={{ color: colors.text }}>
                      Entry {formatScenarioDollars(resolved.entry)} · Stop {formatScenarioDollars(resolved.stop)} ·
                      Target {formatScenarioDollars(resolved.target)}
                    </p>
                    <RrBar riskReward={resolved.riskReward} />
                    {execSummary ? (
                      <p
                        className="m-0 mt-2 text-xs leading-relaxed"
                        style={{ color: colors.text }}
                        data-testid="signals-scenario-exec-summary"
                      >
                        {execSummary.headline}
                        {execSummary.subline ? (
                          <span style={{ color: colors.textMuted }}> — {execSummary.subline}</span>
                        ) : null}
                      </p>
                    ) : null}
                    {showScenarioFixPanel && scenarioRrFix ? (
                      <RrFixGuidancePanel guidance={scenarioRrFix} testId="signals-scenario-result-rr-guidance" />
                    ) : null}
                    {impact.length > 0 ? (
                      <div className="mt-2" data-testid="signals-scenario-impact">
                        <p
                          className="m-0 text-[10px] font-semibold uppercase tracking-wide"
                          style={{ color: colors.textMuted }}
                        >
                          Why it changed
                        </p>
                        <ul className="m-0 mt-1 list-none space-y-1 p-0 text-xs" style={{ color: colors.text }}>
                          {impact.map((line) => (
                            <li key={line.label}>
                              <span className="font-semibold">{line.label}:</span> {line.detail}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {stillBlocked.length > 0 && clearsRr ? (
                      <p
                        className="m-0 mt-2 text-xs leading-relaxed"
                        style={{ color: colors.caution }}
                        data-testid="signals-scenario-still-blocked"
                      >
                        Still held by: {stillBlocked.join(" · ")}
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p
                    className="m-0 mt-2 text-sm leading-relaxed"
                    style={{ color: colors.caution }}
                    data-testid="signals-scenario-result-invalid"
                  >
                    {selectionInvalid ??
                      "This combination does not form valid reference geometry — try another entry style, target, or stop."}
                  </p>
                )}
              </div>

              <button
                type="button"
                className="text-xs font-semibold underline-offset-2 hover:underline"
                style={{ color: colors.textMuted, cursor: "pointer" }}
                data-testid="signals-scenario-reset"
                onClick={() => {
                  setSelection({ ...catalog.defaultSelection });
                }}
              >
                Reset to default
              </button>
              <p className="m-0 text-[10px] leading-relaxed" style={{ color: colors.textMuted }}>
                Reference geometry only — does not change STOCVEST&apos;s system verdict, signal ledger, or composite
                score.
              </p>
            </div>
          ) : null}
        </>
      ) : (
        <button
          type="button"
          className="mt-2 text-xs font-semibold underline-offset-2 hover:underline"
          style={{ color: colors.accent, cursor: "pointer" }}
          data-testid="signals-scenario-adjust-open"
          onClick={() => setOpen(true)}
        >
          Adjust scenario
        </button>
      )}
    </div>
  );
}
