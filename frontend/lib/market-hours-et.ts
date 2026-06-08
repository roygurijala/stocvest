/**
 * US equity market hours — America/New_York, NYSE/NASDAQ schedule.
 *
 * All functions are holiday-aware. Holidays follow NYSE rules:
 *   - Fixed holidays observed on nearest weekday when they fall on a weekend.
 *   - Floating holidays computed algorithmically (no static lookup table).
 *   - Early-close days: July 3 (before Independence Day), Black Friday,
 *     Christmas Eve (1:00 PM ET close).
 */

// ── Internal: ET date parts ───────────────────────────────────────────────────

export function getEtClock(d = new Date()): { hour: number; minute: number; weekday: string } {
  const weekday = d.toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "short" });
  const timeFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  let hour = 0;
  let minute = 0;
  for (const p of timeFmt.formatToParts(d)) {
    if (p.type === "hour") hour = Number.parseInt(p.value, 10);
    if (p.type === "minute") minute = Number.parseInt(p.value, 10);
  }
  return { hour, minute, weekday };
}

export function isoDateInNewYork(d = new Date()): string {
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/** Return a {year, month (1-based), day, weekday (0=Sun)} in ET for a given UTC Date. */
function etDateParts(d: Date): { year: number; month: number; day: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(d);
  let year = 0, month = 0, day = 0;
  for (const p of parts) {
    if (p.type === "year") year = Number.parseInt(p.value, 10);
    if (p.type === "month") month = Number.parseInt(p.value, 10);
    if (p.type === "day") day = Number.parseInt(p.value, 10);
  }
  // weekday via a separate call (simpler)
  const weekday = new Date(year, month - 1, day).getDay(); // local midnight = same calendar date
  return { year, month, day, weekday };
}

// ── Holiday calculation helpers ───────────────────────────────────────────────

/** nth weekday of a month. weekday: 0=Sun…6=Sat, n: 1-based. */
function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): number {
  const firstDow = new Date(year, month - 1, 1).getDay();
  const first = 1 + ((weekday - firstDow + 7) % 7);
  return first + (n - 1) * 7;
}

/** Last occurrence of a weekday in a month. */
function lastWeekdayOfMonth(year: number, month: number, weekday: number): number {
  const daysInMonth = new Date(year, month, 0).getDate();
  const lastDow = new Date(year, month - 1, daysInMonth).getDay();
  return daysInMonth - ((lastDow - weekday + 7) % 7);
}

/**
 * Easter Sunday (Gregorian) via the Anonymous Gregorian algorithm.
 * Returns {month (1-based), day}.
 */
function easterSunday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

/** Good Friday = 2 days before Easter Sunday. Returns {month, day}. */
function goodFriday(year: number): { month: number; day: number } {
  const easter = easterSunday(year);
  const d = new Date(year, easter.month - 1, easter.day - 2);
  return { month: d.getMonth() + 1, day: d.getDate() };
}

/**
 * NYSE holiday observation rule: if a fixed holiday falls on Saturday, observe
 * the preceding Friday; if Sunday, observe the following Monday.
 * Returns year as well — necessary when New Year's Day (Sat) observes on
 * Dec 31 of the PREVIOUS year.
 */
function observed(
  year: number,
  month: number,
  day: number
): { year: number; month: number; day: number } {
  const dow = new Date(year, month - 1, day).getDay();
  if (dow === 6) { // Sat → Fri
    const d = new Date(year, month - 1, day - 1);
    return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
  }
  if (dow === 0) { // Sun → Mon
    const d = new Date(year, month - 1, day + 1);
    return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
  }
  return { year, month, day };
}

// ── Public: NYSE holidays ─────────────────────────────────────────────────────

/**
 * Returns a Set of "YYYY-MM-DD" strings (in ET / calendar date) for all
 * NYSE full-day market holidays in the given year.
 *
 * NYSE holidays:
 *  1. New Year's Day         — Jan 1 (observed)
 *  2. MLK Day                — 3rd Monday of January
 *  3. Presidents' Day        — 3rd Monday of February
 *  4. Good Friday            — Friday before Easter Sunday
 *  5. Memorial Day           — Last Monday of May
 *  6. Juneteenth             — Jun 19 (observed, NYSE adopted 2022)
 *  7. Independence Day       — Jul 4 (observed)
 *  8. Labor Day              — 1st Monday of September
 *  9. Thanksgiving           — 4th Thursday of November
 * 10. Christmas Day          — Dec 25 (observed)
 */
export function nyseHolidaysForYear(year: number): Set<string> {
  const fmt = (m: number, d: number) =>
    `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

  // Helper: formats using the observed date's own year (handles Dec 31 New Year's edge case)
  const push = (obs: { year: number; month: number; day: number }) =>
    holidays.push(
      `${obs.year}-${String(obs.month).padStart(2, "0")}-${String(obs.day).padStart(2, "0")}`
    );

  const holidays: string[] = [];

  // 1. New Year's Day — may observe on Dec 31 of the PREVIOUS year
  push(observed(year, 1, 1));

  // 2. MLK Day — 3rd Monday of January
  holidays.push(fmt(1, nthWeekdayOfMonth(year, 1, 1, 3)));

  // 3. Presidents' Day — 3rd Monday of February
  holidays.push(fmt(2, nthWeekdayOfMonth(year, 2, 1, 3)));

  // 4. Good Friday
  const gf = goodFriday(year);
  holidays.push(fmt(gf.month, gf.day));

  // 5. Memorial Day — last Monday of May
  holidays.push(fmt(5, lastWeekdayOfMonth(year, 5, 1)));

  // 6. Juneteenth — Jun 19 (NYSE adopted 2022)
  if (year >= 2022) {
    push(observed(year, 6, 19));
  }

  // 7. Independence Day — Jul 4 (observed)
  push(observed(year, 7, 4));

  // 8. Labor Day — 1st Monday of September
  holidays.push(fmt(9, nthWeekdayOfMonth(year, 9, 1, 1)));

  // 9. Thanksgiving — 4th Thursday of November
  holidays.push(fmt(11, nthWeekdayOfMonth(year, 11, 4, 4)));

  // 10. Christmas — Dec 25 (observed)
  push(observed(year, 12, 25));

  return new Set(holidays);
}

/**
 * True if the given ET calendar date is a NYSE full-day holiday.
 * Also checks year+1 holidays because New Year's Day observed on Saturday
 * can land on Dec 31 of the previous year.
 */
export function isNyseHoliday(etDateIso: string): boolean {
  const year = Number.parseInt(etDateIso.slice(0, 4), 10);
  return (
    nyseHolidaysForYear(year).has(etDateIso) ||
    nyseHolidaysForYear(year + 1).has(etDateIso)
  );
}

/**
 * NYSE early-close days end at 1:00 PM ET.
 * Returns the early-close minute-of-day (780) or null if normal close.
 *
 * Early-close days:
 *  - July 3 — only when July 4 is observed on July 4 (i.e., Jul 4 is a weekday)
 *  - Black Friday — day after Thanksgiving
 *  - Christmas Eve (Dec 24) — only when Dec 25 is observed on Dec 25
 */
export function nyseEarlyCloseMinutes(etDateIso: string): number | null {
  const year = Number.parseInt(etDateIso.slice(0, 4), 10);
  const [, mm, dd] = etDateIso.split("-").map(Number);

  // July 3 early close: only when July 4 is not shifted (i.e., observed on Jul 4 itself)
  if (mm === 7 && dd === 3) {
    const indepDay = observed(year, 7, 4);
    if (indepDay.month === 7 && indepDay.day === 4) {
      // July 3 must itself be a weekday
      const dow = new Date(year, 6, 3).getDay();
      if (dow >= 1 && dow <= 5) return 13 * 60; // 780 min
    }
  }

  // Black Friday (day after Thanksgiving)
  const thanksgivingDay = nthWeekdayOfMonth(year, 11, 4, 4);
  const blackFriday = new Date(year, 10, thanksgivingDay + 1);
  if (mm === blackFriday.getMonth() + 1 && dd === blackFriday.getDate()) {
    return 13 * 60;
  }

  // Christmas Eve: Dec 24, only when Dec 25 is observed on Dec 25 (i.e., Dec 25 is a weekday)
  if (mm === 12 && dd === 24) {
    const xmas = observed(year, 12, 25);
    if (xmas.month === 12 && xmas.day === 25) {
      const dow = new Date(year, 11, 24).getDay();
      if (dow >= 1 && dow <= 5) return 13 * 60;
    }
  }

  return null;
}

// ── Public: session status ────────────────────────────────────────────────────

/** True when the NYSE regular session is currently open (holiday-aware). */
export function isUsRegularSessionOpenEt(now = new Date()): boolean {
  const { hour, minute, weekday } = getEtClock(now);
  if (weekday === "Sat" || weekday === "Sun") return false;
  const etIso = isoDateInNewYork(now);
  if (isNyseHoliday(etIso)) return false;
  const t = hour * 60 + minute;
  const open = 9 * 60 + 30;
  const earlyClose = nyseEarlyCloseMinutes(etIso);
  const close = earlyClose ?? 16 * 60;
  return t >= open && t < close;
}

export type MarketSessionPhase = "pre" | "live" | "post" | "closed";

/**
 * Coarse US-equity session phase from the ET wall clock:
 *   • pre    — 4:00 AM – 9:30 AM ET (pre-market)
 *   • live   — 9:30 AM – close ET (regular session; 1 PM on early-close days)
 *   • post   — close – 8:00 PM ET (after-hours)
 *   • closed — overnight, weekends, holidays
 *
 * Fully holiday-aware.
 */
export function getMarketSessionPhaseEt(now = new Date()): MarketSessionPhase {
  const { hour, minute, weekday } = getEtClock(now);
  if (weekday === "Sat" || weekday === "Sun") return "closed";
  const etIso = isoDateInNewYork(now);
  if (isNyseHoliday(etIso)) return "closed";
  const t = hour * 60 + minute;
  if (t >= 4 * 60 && t < 9 * 60 + 30) return "pre";
  const earlyClose = nyseEarlyCloseMinutes(etIso);
  const close = earlyClose ?? 16 * 60;
  if (t >= 9 * 60 + 30 && t < close) return "live";
  if (t >= close && t < 20 * 60) return "post";
  return "closed";
}

/** Soft dip-buy window for day-desk planning context (2:00–3:30 PM ET, trading days only). */
export function isInDayDipWindowEt(now = new Date()): boolean {
  const { hour, minute, weekday } = getEtClock(now);
  if (weekday === "Sat" || weekday === "Sun") return false;
  if (isNyseHoliday(isoDateInNewYork(now))) return false;
  const t = hour * 60 + minute;
  return t >= 14 * 60 && t <= 15 * 60 + 30;
}

/** True when ET wall clock is strictly after 10:00 AM on a trading day. */
export function isAfterOrbCloseEt(now = new Date()): boolean {
  const { hour, minute, weekday } = getEtClock(now);
  if (weekday === "Sat" || weekday === "Sun") return true;
  if (isNyseHoliday(isoDateInNewYork(now))) return true;
  return hour > 10 || (hour === 10 && minute > 0);
}

export function barIsPremarketEt(barIso: string): boolean {
  const { hour, minute } = getEtClock(new Date(barIso));
  const t = hour * 60 + minute;
  return t >= 4 * 60 && t < 9 * 60 + 30;
}

// ── Internal: next trading day ────────────────────────────────────────────────

/** Advance a local-midnight Date by `days` calendar days. */
function addDays(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
}

/**
 * Returns the next NYSE trading day (in ET calendar date YYYY-MM-DD) after
 * `etDateIso`, skipping weekends and holidays.
 */
function nextTradingDayAfter(etDateIso: string): string {
  const [y, m, d] = etDateIso.split("-").map(Number);
  let cursor = new Date(y, m - 1, d);
  for (let i = 0; i < 10; i++) {
    cursor = addDays(cursor, 1);
    const dow = cursor.getDay();
    if (dow === 0 || dow === 6) continue;
    const iso = cursor.toLocaleDateString("en-CA"); // YYYY-MM-DD
    if (!isNyseHoliday(iso)) return iso;
  }
  return ""; // should never reach here
}

// ── Public: human labels ──────────────────────────────────────────────────────

// ── Public: last trading date ─────────────────────────────────────────────────

/**
 * Returns the most-recent NYSE trading day as a "YYYY-MM-DD" ET calendar date.
 *
 * If today is a trading day AND the market has already opened (≥ 09:30 ET),
 * returns today. Otherwise walks backward until it finds a weekday that is
 * not a NYSE holiday.
 *
 * Guarantees: the returned date is always ≤ etToday, it is a weekday, and it
 * is not a NYSE holiday. Searches up to 14 calendar days back.
 */
export function getLastTradingDate(now = new Date()): string {
  const etIso = isoDateInNewYork(now);
  const { hour, minute, weekday } = getEtClock(now);
  const t = hour * 60 + minute;
  const openMinute = 9 * 60 + 30;

  // If it is currently a trading day and the session has started, use today.
  const isTradingDay = weekday !== "Sat" && weekday !== "Sun" && !isNyseHoliday(etIso);
  if (isTradingDay && t >= openMinute) return etIso;

  // Otherwise walk backward to find the previous trading day.
  const [y, m, d] = etIso.split("-").map(Number);
  let cursor = new Date(y, m - 1, d);
  for (let i = 0; i < 14; i++) {
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - 1);
    const dow = cursor.getDay(); // 0=Sun, 6=Sat
    if (dow === 0 || dow === 6) continue;
    const iso = cursor.toLocaleDateString("en-CA"); // YYYY-MM-DD
    if (!isNyseHoliday(iso)) return iso;
  }
  // Unreachable in practice — 14 days always contains a trading day.
  return etIso;
}

/**
 * Formats a YYYY-MM-DD date string as a short human label, e.g. "Fri Jun 6".
 * Useful for staleness labels on the signal feed.
 */
export function formatTradingDateLabel(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

/** Human label for when the regular session next opens (ET). Holiday-aware. */
export function nextRegularSessionOpenLabel(now = new Date()): string {
  if (isUsRegularSessionOpenEt(now)) return "Regular session is open";
  const etIso = isoDateInNewYork(now);
  const { hour, minute, weekday } = getEtClock(now);
  const t = hour * 60 + minute;
  const open = 9 * 60 + 30;

  // Still before today's open on a trading day?
  const isTradingDay = weekday !== "Sat" && weekday !== "Sun" && !isNyseHoliday(etIso);
  if (isTradingDay && t < open) return "Today 9:30 AM ET";

  // Find next trading day
  const next = nextTradingDayAfter(etIso);
  if (!next) return "Next trading day 9:30 AM ET";

  const nextDate = new Date(Number(next.slice(0, 4)), Number(next.slice(5, 7)) - 1, Number(next.slice(8, 10)));
  const todayDate = new Date(Number(etIso.slice(0, 4)), Number(etIso.slice(5, 7)) - 1, Number(etIso.slice(8, 10)));
  const diffDays = Math.round((nextDate.getTime() - todayDate.getTime()) / 86_400_000);

  if (diffDays === 1) return "Tomorrow 9:30 AM ET";
  const label = nextDate.toLocaleDateString("en-US", { weekday: "long" });
  return `${label} 9:30 AM ET`;
}
