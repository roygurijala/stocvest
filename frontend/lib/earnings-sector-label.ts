/** Display sector for earnings rows — heuristic until API exposes SIC/sector. */

const SYMBOL_SECTOR: Record<string, string> = {
  AAPL: "Tech",
  MSFT: "Tech",
  NVDA: "Tech",
  GOOGL: "Tech",
  GOOG: "Tech",
  AMZN: "Retail",
  META: "Tech",
  TSLA: "Auto",
  BRK: "Financials",
  "BRK.A": "Financials",
  "BRK.B": "Financials",
  JPM: "Financials",
  BAC: "Financials",
  WFC: "Financials",
  GS: "Financials",
  V: "Financials",
  MA: "Financials",
  XOM: "Energy",
  CVX: "Energy",
  COP: "Energy",
  SLB: "Energy",
  DLNG: "Energy",
  KO: "Beverages",
  PEP: "Beverages",
  WMT: "Retail",
  COST: "Retail",
  HD: "Retail",
  LOW: "Retail",
  TGT: "Retail",
  DELL: "Tech",
  CRM: "Software",
  ORCL: "Software",
  ADBE: "Software",
  INTC: "Semis",
  AMD: "Semis",
  AVGO: "Semis",
  QCOM: "Semis",
  LLY: "Healthcare",
  JNJ: "Healthcare",
  UNH: "Healthcare",
  PFE: "Healthcare",
  MRK: "Healthcare",
  COIN: "Crypto",
  MSTR: "Crypto",
  MARA: "Crypto",
  RIOT: "Crypto"
};

const NAME_RULES: { pattern: RegExp; label: string }[] = [
  { pattern: /\b(lng|oil|gas|energy|petroleum|refin|pipeline|drill)\b/i, label: "Energy" },
  { pattern: /\b(bank|bancorp|financial|capital markets|credit|insurance)\b/i, label: "Financials" },
  { pattern: /\b(software|saas|cloud|cyber)\b/i, label: "Software" },
  { pattern: /\b(semiconductor|chip|micro)\b/i, label: "Semis" },
  { pattern: /\b(retail|stores|department)\b/i, label: "Retail" },
  { pattern: /\b(beverage|brew|drink|cola)\b/i, label: "Beverages" },
  { pattern: /\b(auto|motor|vehicle)\b/i, label: "Auto" },
  { pattern: /\b(pharma|therapeutic|biotech|health)\b/i, label: "Healthcare" },
  { pattern: /\b(bitcoin|crypto|blockchain|digital asset)\b/i, label: "Crypto" },
  { pattern: /\b(technology|tech|systems|data)\b/i, label: "Tech" },
  { pattern: /\b(communication|media|entertainment)\b/i, label: "Media" },
  { pattern: /\b(real estate|reit|property)\b/i, label: "REIT" },
  { pattern: /\b(utility|utilities|power)\b/i, label: "Utilities" },
  { pattern: /\b(aerospace|defense|airline)\b/i, label: "Industrials" }
];

export function earningsSectorLabel(symbol: string, companyName?: string | null): string {
  const sym = symbol.trim().toUpperCase();
  const mapped = SYMBOL_SECTOR[sym];
  if (mapped) return mapped;

  const name = (companyName || "").trim();
  if (name) {
    for (const { pattern, label } of NAME_RULES) {
      if (pattern.test(name)) return label;
    }
  }
  return "—";
}
