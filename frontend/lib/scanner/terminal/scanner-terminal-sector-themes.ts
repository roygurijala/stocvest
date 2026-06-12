/**
 * Sector theme cards for Scanner Terminal "On radar" — ETF momentum + funnel symbols.
 */

import type { DeskTodayData } from "@/lib/api/desk-today";
import type { GapIntelligenceItem, IntradaySetupPayload } from "@/lib/api/scanner";
import type { SectorRotationChip } from "@/lib/market-context/types";
import type { ScannerTerminalRadarGroup } from "@/lib/scanner/terminal/scanner-terminal-model";
import { SYMBOL_TO_SECTOR_ETF } from "@/lib/scanner/terminal/symbol-sector-etf-map";

export { SYMBOL_TO_SECTOR_ETF };

const ETF_DISPLAY: Record<string, string> = {
  XLK: "Tech / cloud",
  XLC: "Communication / media",
  XLE: "Energy",
  XLF: "Financials",
  XLY: "Consumer / EV",
  XLV: "Healthcare",
  XLP: "Consumer staples",
  XLI: "Industrials",
  XLRE: "Real estate",
  XLU: "Utilities",
  XLB: "Materials"
};

function sectorMomentumNote(chip: SectorRotationChip | undefined): string {
  const pct = chip?.pct5d;
  if (pct == null || !Number.isFinite(pct)) return "Monitoring sector flow";
  if (pct >= 1.5) return `Sector momentum +${pct.toFixed(1)}% (5d) — rotation tailwind`;
  if (pct >= 0.4) return `Volume building — sector +${pct.toFixed(1)}% over 5d`;
  if (pct <= -1.5) return `Sector lag ${pct.toFixed(1)}% (5d) — defensive rotation`;
  if (pct <= -0.4) return `Mixed tape — sector ${pct.toFixed(1)}% (5d)`;
  return "Flat sector tape — stock-specific setups matter more";
}

export function collectFunnelSymbols(args: {
  gapIntelligence: GapIntelligenceItem[];
  setups: IntradaySetupPayload[];
  swingDesk: DeskTodayData | null | undefined;
  dayDesk: DeskTodayData | null | undefined;
  watchlistSymbols: Iterable<string>;
}): string[] {
  const set = new Set<string>();
  const add = (sym: string | undefined | null) => {
    const s = (sym ?? "").trim().toUpperCase();
    if (s) set.add(s);
  };
  for (const g of args.gapIntelligence) add(g.symbol);
  for (const s of args.setups) add(s.symbol);
  for (const l of args.swingDesk?.discovery ?? []) add(l.symbol);
  for (const l of args.dayDesk?.discovery ?? []) add(l.symbol);
  for (const l of args.swingDesk?.quiet_leaders ?? []) add(l.symbol);
  for (const l of args.dayDesk?.quiet_leaders ?? []) add(l.symbol);
  for (const l of args.swingDesk?.movers_radar ?? []) add(l.symbol);
  for (const l of args.dayDesk?.movers_radar ?? []) add(l.symbol);
  for (const sym of args.watchlistSymbols) add(sym);
  return [...set];
}

export function parseSectorRotationEnvelope(
  envelope: { data?: unknown } | null | undefined
): SectorRotationChip[] {
  const data = envelope?.data;
  if (!Array.isArray(data)) return [];
  const out: SectorRotationChip[] = [];
  for (const row of data) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const symbol = String(o.symbol ?? "").trim().toUpperCase();
    const label = String(o.label ?? o.name ?? symbol).trim();
    const pct5d = typeof o.pct5d === "number" && Number.isFinite(o.pct5d) ? o.pct5d : null;
    if (!symbol) continue;
    out.push({ symbol, label, pct5d });
  }
  return out;
}

export function buildSectorThemeGroups(
  sectorRotation: SectorRotationChip[],
  funnelSymbols: string[]
): ScannerTerminalRadarGroup[] {
  const chipByEtf = new Map(sectorRotation.map((c) => [c.symbol.toUpperCase(), c]));
  const byEtf = new Map<string, string[]>();

  for (const sym of funnelSymbols) {
    const etf = SYMBOL_TO_SECTOR_ETF[sym];
    if (!etf) continue;
    const list = byEtf.get(etf) ?? [];
    if (!list.includes(sym)) list.push(sym);
    byEtf.set(etf, list);
  }

  const rankedEtfs = [...byEtf.entries()]
    .map(([etf, symbols]) => {
      const chip = chipByEtf.get(etf);
      const momentum = chip?.pct5d ?? 0;
      return { etf, symbols, chip, momentum };
    })
    .filter((row) => row.symbols.length > 0)
    .sort((a, b) => Math.abs(b.momentum) - Math.abs(a.momentum));

  return rankedEtfs.slice(0, 4).map((row) => {
    const symbols = row.symbols.slice(0, 6);
    return {
      id: `sector-${row.etf.toLowerCase()}`,
      title: ETF_DISPLAY[row.etf] ?? row.chip?.label ?? row.etf,
      symbols,
      note: sectorMomentumNote(row.chip),
      themeKind: "sector" as const,
      sectorEtf: row.etf,
      symbolRoles: Object.fromEntries(symbols.map((sym) => [sym, "peer" as const]))
    };
  });
}
