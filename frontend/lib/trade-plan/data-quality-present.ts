export type DataQualityFlag = {
  id: string;
  label: string;
  severity: "warn" | "info";
};

export function buildDataQualityFlags(input: {
  isInsufficient: boolean;
  unavailableMessage?: string | null;
  entryZoneQuality?: string | null;
  layersAligned?: number | null;
  layersTotal?: number | null;
  minLayers?: number;
}): DataQualityFlag[] {
  const flags: DataQualityFlag[] = [];
  if (input.isInsufficient) {
    flags.push({
      id: "insufficient",
      label: input.unavailableMessage?.trim() || "Insufficient layer data for a full desk read.",
      severity: "warn"
    });
    return flags;
  }
  if (input.entryZoneQuality === "no_clean_entry") {
    flags.push({
      id: "no_clean_entry",
      label: "No clean entry band — stop and target are too tight for a validated zone near current price.",
      severity: "warn"
    });
  } else if (input.entryZoneQuality === "clamped") {
    flags.push({
      id: "clamped_zone",
      label: "Entry zone was tightened so the top of the band keeps acceptable reward-to-risk.",
      severity: "info"
    });
  }
  const min = input.minLayers ?? 3;
  const total = input.layersTotal;
  const aligned = input.layersAligned;
  if (total != null && total < 6) {
    flags.push({
      id: "partial_layers",
      label: `Only ${total} layers available in this evaluation (desk prefers ${min}+ live layers).`,
      severity: "info"
    });
  }
  if (aligned != null && total != null && aligned < 3) {
    flags.push({
      id: "low_alignment",
      label: `Low layer alignment (${aligned}/${total}) — reference levels may be less reliable.`,
      severity: "warn"
    });
  }
  return flags;
}
