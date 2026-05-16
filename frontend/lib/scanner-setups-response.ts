/** Parse day/swing setups API responses (legacy array or v2 bundle). */

import type { IntradaySetupPayload } from "@/lib/api/scanner";

export type ScannerSetupsDeskBundle = {
  qualifying: IntradaySetupPayload[];
  nearQualification: IntradaySetupPayload[];
};

export function isSwingSetupRow(row: IntradaySetupPayload): boolean {
  return row.scanner_mode === "swing_daily";
}

export function parseScannerSetupsDeskResponse(data: unknown): ScannerSetupsDeskBundle {
  if (Array.isArray(data)) {
    return { qualifying: data as IntradaySetupPayload[], nearQualification: [] };
  }
  if (!data || typeof data !== "object") {
    return { qualifying: [], nearQualification: [] };
  }
  const o = data as { qualifying?: unknown; near_qualification?: unknown };
  const qualifying = Array.isArray(o.qualifying) ? (o.qualifying as IntradaySetupPayload[]) : [];
  const nearQualification = Array.isArray(o.near_qualification)
    ? (o.near_qualification as IntradaySetupPayload[])
    : [];
  return { qualifying, nearQualification };
}

export function mergeDeskSetupBundles(
  swing: ScannerSetupsDeskBundle,
  day: ScannerSetupsDeskBundle
): { qualifying: IntradaySetupPayload[]; nearQualification: IntradaySetupPayload[] } {
  const qualifying = [...swing.qualifying, ...day.qualifying];
  const nearQualification = [...swing.nearQualification, ...day.nearQualification];
  nearQualification.sort((a, b) => b.score - a.score);
  return { qualifying, nearQualification: nearQualification.slice(0, 10) };
}
