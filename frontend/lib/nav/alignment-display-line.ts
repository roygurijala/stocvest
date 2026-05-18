import { formatAlignmentStatusLine } from "@/lib/alignment-display-tier";

/** B47 alignment line for Signals / evidence surfaces. */
export function signalsAlignmentDisplayLine(input: {
  layersAligned: number;
  layersTotal?: number;
  maturationState?: string | null;
}): string {
  return formatAlignmentStatusLine(input);
}
