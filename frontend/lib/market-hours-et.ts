/** US equity regular session in America/New_York (9:30–16:00, Mon–Fri). */

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

export function isUsRegularSessionOpenEt(now = new Date()): boolean {
  const { hour, minute, weekday } = getEtClock(now);
  if (weekday === "Sat" || weekday === "Sun") return false;
  const t = hour * 60 + minute;
  const open = 9 * 60 + 30;
  const close = 16 * 60;
  return t >= open && t < close;
}

/** True when ET wall clock is strictly after 10:00 AM (ORB window ended). */
export function isAfterOrbCloseEt(now = new Date()): boolean {
  const { hour, minute, weekday } = getEtClock(now);
  if (weekday === "Sat" || weekday === "Sun") return true;
  return hour > 10 || (hour === 10 && minute > 0);
}

export function barIsPremarketEt(barIso: string): boolean {
  const { hour, minute } = getEtClock(new Date(barIso));
  const t = hour * 60 + minute;
  return t >= 4 * 60 && t < 9 * 60 + 30;
}

/** Human label for when the regular session next opens (ET). */
export function nextRegularSessionOpenLabel(now = new Date()): string {
  if (isUsRegularSessionOpenEt(now)) return "Regular session is open";
  const { hour, minute, weekday } = getEtClock(now);
  if (weekday === "Sat") return "Monday 9:30 AM ET";
  if (weekday === "Sun") return "Monday 9:30 AM ET";
  const t = hour * 60 + minute;
  const open = 9 * 60 + 30;
  if (t < open) return "Today 9:30 AM ET";
  return "Next trading day 9:30 AM ET";
}
