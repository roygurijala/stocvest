import type { SnapshotPayload } from "@/lib/api/market";
import type {
  ScannerTerminalGapRow,
  ScannerTerminalRadarGroup,
  ScannerTerminalSymbolRole
} from "@/lib/scanner/terminal/scanner-terminal-model";

export type ThemeSymbolRow = {
  symbol: string;
  roleLabel: string;
  companyHint: string | null;
  stakeHint: string | null;
  changePct: number | null;
  price: number | null;
  gapPct: number | null;
  statusLabel: string;
  statusTone: "bull" | "bear" | "neutral" | "caution";
};

const ROLE_LABEL: Record<ScannerTerminalSymbolRole, string> = {
  listed: "Listing",
  corporate: "Corp",
  etf: "ETF",
  peer: "Peer"
};

function sessionPrice(snap: SnapshotPayload | undefined): number | null {
  if (!snap) return null;
  const pre = snap.pre_market_price;
  if (typeof pre === "number" && Number.isFinite(pre) && pre > 0) return pre;
  const last = snap.last_trade_price;
  if (typeof last === "number" && Number.isFinite(last) && last > 0) return last;
  const open = snap.day_open;
  if (typeof open === "number" && Number.isFinite(open) && open > 0) return open;
  return null;
}

function sessionChangePct(snap: SnapshotPayload | undefined, gapPct: number | null): number | null {
  if (gapPct != null && Number.isFinite(gapPct)) return gapPct;
  if (!snap) return null;
  const pre = snap.pre_market_change_percent;
  if (typeof pre === "number" && Number.isFinite(pre)) return pre;
  const ch = snap.change_percent;
  if (typeof ch === "number" && Number.isFinite(ch)) return ch;
  const price = sessionPrice(snap);
  const prev = snap.prev_close;
  if (price != null && typeof prev === "number" && Number.isFinite(prev) && prev > 0) {
    return ((price - prev) / prev) * 100;
  }
  return null;
}

function statusFromChange(changePct: number | null, gapRow: ScannerTerminalGapRow | undefined): {
  label: string;
  tone: ThemeSymbolRow["statusTone"];
} {
  if (gapRow?.isIpoWatch) return { label: "IPO watch", tone: "caution" };
  if (gapRow?.statusLabel) {
    const label = gapRow.statusLabel === "accepted" ? "Gap up" : gapRow.statusLabel;
    const tone =
      gapRow.gapPct >= 2 ? "bull" : gapRow.gapPct <= -2 ? "bear" : gapRow.statusLabel === "fill watch" ? "caution" : "neutral";
    return { label, tone };
  }
  if (changePct == null) return { label: "Watch", tone: "neutral" };
  if (changePct >= 2) return { label: "Gap up", tone: "bull" };
  if (changePct <= -2) return { label: "Gap down", tone: "bear" };
  if (Math.abs(changePct) >= 0.4) return { label: "Moving", tone: changePct >= 0 ? "bull" : "bear" };
  return { label: "Watch", tone: "neutral" };
}

export function buildThemeSymbolRows(args: {
  group: ScannerTerminalRadarGroup;
  snapshots: Map<string, SnapshotPayload>;
  gapBySymbol: Map<string, ScannerTerminalGapRow>;
}): ThemeSymbolRow[] {
  const { group, snapshots, gapBySymbol } = args;
  const stakeNotes = group.stakeNotes ?? {};

  return group.symbols.map((symbol) => {
    const sym = symbol.trim().toUpperCase();
    const snap = snapshots.get(sym);
    const gapRow = gapBySymbol.get(sym);
    const role = group.symbolRoles?.[sym] ?? "peer";
    const isListedAwaiting =
      role === "listed" && group.listedTicker?.toUpperCase() === sym && sessionPrice(snap) == null;

    const gapPct = gapRow?.gapPct ?? null;
    const changePct = sessionChangePct(snap, gapPct);
    const status = isListedAwaiting
      ? { label: "Awaiting open", tone: "caution" as const }
      : statusFromChange(changePct, gapRow);

    const companyHint =
      snap?.company_name?.trim() ||
      (role === "listed" ? group.triggerEntity ?? null : null) ||
      null;

    return {
      symbol: sym,
      roleLabel: ROLE_LABEL[role],
      companyHint,
      changePct,
      price: sessionPrice(snap),
      gapPct,
      statusLabel: status.label,
      statusTone: status.tone,
      stakeHint: stakeNotes[sym] ?? null
    };
  });
}
