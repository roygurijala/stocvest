import type { SnapshotPayload } from "@/lib/api/market";
import type { ScannerTerminalGapRow } from "@/lib/scanner/terminal/scanner-terminal-model";

function sessionPrice(snap: SnapshotPayload): number | null {
  const pre = snap.pre_market_price;
  if (typeof pre === "number" && Number.isFinite(pre) && pre > 0) return pre;
  const last = snap.last_trade_price;
  if (typeof last === "number" && Number.isFinite(last) && last > 0) return last;
  const open = snap.day_open;
  if (typeof open === "number" && Number.isFinite(open) && open > 0) return open;
  const close = snap.day_close;
  if (typeof close === "number" && Number.isFinite(close) && close > 0) return close;
  return null;
}

export function gapStatusDisplayLabel(row: ScannerTerminalGapRow): string {
  if (row.isIpoWatch || row.statusLabel === "unscored") return "IPO - unscored";
  if (row.statusLabel === "accepted") return "gap accepted";
  return row.statusLabel;
}

export function formatGapPriceContext(row: ScannerTerminalGapRow): string | null {
  const prev = row.prevClose;
  const cur = row.currentPrice;
  if (row.isIpoWatch) {
    if (typeof prev === "number" && Number.isFinite(prev) && prev > 0) {
      return `Priced $${prev.toFixed(2)} · first trade ~9:50`;
    }
    return "First trade expected ~9:50 AM ET";
  }
  if (
    typeof prev === "number" &&
    Number.isFinite(prev) &&
    prev > 0 &&
    typeof cur === "number" &&
    Number.isFinite(cur) &&
    cur > 0
  ) {
    return `$${prev.toFixed(2)} → $${cur.toFixed(2)}`;
  }
  if (typeof cur === "number" && Number.isFinite(cur) && cur > 0) {
    return `$${cur.toFixed(2)}`;
  }
  return null;
}

export function gapCatalystBody(row: ScannerTerminalGapRow): { text: string; italic: boolean } | null {
  if (row.catalystDescription?.trim()) {
    return { text: row.catalystDescription.trim(), italic: false };
  }
  if (row.catalystHeadline?.trim()) {
    return { text: row.catalystHeadline.trim(), italic: false };
  }
  if (row.noCatalystWarning?.trim()) {
    return { text: row.noCatalystWarning.trim(), italic: true };
  }
  if (row.note?.trim()) {
    return { text: row.note.trim(), italic: !row.hasCatalyst };
  }
  return null;
}

export function enrichGapRowFromSnapshot(
  row: ScannerTerminalGapRow,
  snap: SnapshotPayload | null | undefined,
  companyFallback?: string | null
): ScannerTerminalGapRow {
  const company =
    row.company?.trim() ||
    snap?.company_name?.trim() ||
    companyFallback?.trim() ||
    null;

  if (!snap) {
    return { ...row, company };
  }

  const price = sessionPrice(snap);
  const prev =
    typeof snap.prev_close === "number" && Number.isFinite(snap.prev_close) && snap.prev_close > 0
      ? snap.prev_close
      : row.prevClose;
  const current =
    price != null && price > 0
      ? price
      : typeof row.currentPrice === "number" && Number.isFinite(row.currentPrice) && row.currentPrice > 0
        ? row.currentPrice
        : 0;

  let gapPct = row.gapPct;
  if (prev > 0 && current > 0) {
    gapPct = ((current - prev) / prev) * 100;
  }

  return {
    ...row,
    company,
    prevClose: prev,
    currentPrice: current,
    gapPct,
    gapDollars: current > 0 && prev > 0 ? current - prev : row.gapDollars
  };
}
