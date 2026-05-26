/**
 * User-facing copy for manual desk refresh failures.
 */

export function formatDeskRefreshErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const msg = raw.trim();
  if (!msg) {
    return "Desk refresh did not complete — cached movers above are still shown.";
  }
  if (/service unavailable|503|504|502|timed?\s*out|timeout/i.test(msg)) {
    return "Full desk refresh timed out (server limit) — cached movers above are still shown.";
  }
  if (/429|cooldown/i.test(msg)) {
    return msg;
  }
  return msg;
}
