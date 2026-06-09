/**
 * IPO ecosystem cards for Scanner Terminal "On radar" — from GET /v1/scanner/ipo-ecosystems.
 */

import type { IpoEcosystemPayload } from "@/lib/api/fetch-ipo-ecosystems";
import type { ScannerTerminalRadarGroup } from "@/lib/scanner/terminal/scanner-terminal-model";

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

export function buildIpoEcosystemRadarGroups(
  ecosystems: IpoEcosystemPayload[] | null | undefined
): ScannerTerminalRadarGroup[] {
  if (!ecosystems?.length) return [];

  const sorted = [...ecosystems].sort((a, b) => priority(b) - priority(a));

  return sorted.slice(0, 3).map((eco) => {
    const symbols = [
      ...eco.corporate_backers,
      ...eco.etf_holders,
      ...eco.theme_peers.slice(0, 2)
    ]
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

    const unique = [...new Set(symbols)].slice(0, 8);
    const id = `ipo-${eco.registry_key}`;

    return {
      id,
      title: `${eco.trigger_entity} exposure`,
      symbols: unique,
      note: ecosystemNote(eco)
    };
  });
}
