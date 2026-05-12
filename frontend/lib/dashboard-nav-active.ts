/**
 * Sidebar / mobile nav active state: `/dashboard` must not match `/dashboard/scanner`
 * (prefix matching would highlight both). The same exact-match rule
 * applies to `/dashboard/admin` — it's the admin Overview entry, and
 * the four sub-pages (proposals/parameters/users/audit) each have their
 * own nav item, so highlighting Overview while on those would always
 * show two "active" rows. Other routes keep prefix matching so nested
 * pages light up the parent route (e.g. `/dashboard/signals/detail`
 * still highlights `/dashboard/signals`).
 */
export function isDashboardNavItemActive(pathname: string, href: string): boolean {
  const norm = (p: string) => (p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p);
  const p = norm(pathname);
  const h = norm(href);
  if (h === "/dashboard" || h === "/dashboard/admin") {
    return p === h;
  }
  return p === h || p.startsWith(`${h}/`);
}
