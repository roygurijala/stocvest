/**
 * IPO ecosystem cards for Scanner Terminal "On radar" — from GET /v1/scanner/ipo-ecosystems.
 */

import type { IpoEcosystemPayload } from "@/lib/api/fetch-ipo-ecosystems";
import type {
  ScannerTerminalRadarGroup,
  ScannerTerminalSymbolRole
} from "@/lib/scanner/terminal/scanner-terminal-model";

function ecosystemNote(eco: IpoEcosystemPayload): string {
  if (eco.target_ipo_window?.trim()) return eco.target_ipo_window.trim();
  if (eco.ipo_date) return `IPO window — listing ${eco.ipo_date}`;
  if (eco.s1_filed_date) return `S-1 filed ${eco.s1_filed_date} — roadshow narratives may distort news`;
  return "IPO ecosystem exposure — mechanical flows may distort volume reads";
}

function priority(eco: IpoEcosystemPayload): number {
  if (eco.listed_ticker) return 3;
  if (eco.s1_filed_date) return 2;
  return 1;
}

function orderedThemeSymbols(eco: IpoEcosystemPayload): {
  symbols: string[];
  symbolRoles: Record<string, ScannerTerminalSymbolRole>;
} {
  const symbols: string[] = [];
  const symbolRoles: Record<string, ScannerTerminalSymbolRole> = {};
  const add = (sym: string | null | undefined, role: ScannerTerminalSymbolRole) => {
    const s = (sym ?? "").trim().toUpperCase();
    if (!s || symbols.includes(s)) return;
    symbols.push(s);
    symbolRoles[s] = role;
  };

  if (eco.listed_ticker) add(eco.listed_ticker, "listed");
  for (const s of eco.corporate_backers) add(s, "corporate");
  for (const s of eco.etf_holders) add(s, "etf");
  for (const s of eco.theme_peers) add(s, "peer");

  return { symbols: symbols.slice(0, 12), symbolRoles };
}

export function buildIpoEcosystemRadarGroups(
  ecosystems: IpoEcosystemPayload[] | null | undefined
): ScannerTerminalRadarGroup[] {
  if (!ecosystems?.length) return [];

  const sorted = [...ecosystems].sort((a, b) => priority(b) - priority(a));

  return sorted.slice(0, 3).map((eco) => {
    const { symbols, symbolRoles } = orderedThemeSymbols(eco);
    const id = `ipo-${eco.registry_key}`;

    return {
      id,
      title: `${eco.trigger_entity} exposure`,
      symbols,
      note: ecosystemNote(eco),
      themeKind: "ipo_ecosystem",
      registryKey: eco.registry_key,
      triggerEntity: eco.trigger_entity,
      listedTicker: eco.listed_ticker,
      ipoDate: eco.ipo_date,
      targetIpoWindow: eco.target_ipo_window,
      indexInclusionEnd: eco.index_inclusion_window_end,
      ipoOfferPrice: eco.ipo_offer_price,
      stakeNotes: eco.stake_notes,
      symbolRoles
    };
  });
}
