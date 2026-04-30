/** Public env label for client + server. Only `"development"` enables dev-only UI (e.g. login bypass). */

export function isStocvestDevelopment(): boolean {
  const v = process.env.NEXT_PUBLIC_STOCVEST_ENV;
  return typeof v === "string" && v.trim() === "development";
}
