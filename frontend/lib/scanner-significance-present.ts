export type ScannerSignificanceLabel = "high significance" | "moderate significance" | "low significance";

export function scannerSignificanceLabel(score: number): ScannerSignificanceLabel {
  if (!Number.isFinite(score)) return "low significance";
  if (score >= 75) return "high significance";
  if (score >= 45) return "moderate significance";
  return "low significance";
}
