/**
 * Sidebar / mobile nav active state: `/dashboard` must not match `/dashboard/scanner`
 * (prefix matching would highlight both). Other routes keep prefix matching for nested paths.
 */
export function isDashboardNavItemActive(pathname: string, href: string): boolean {
  const norm = (p: string) => (p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p);
  const p = norm(pathname);
  const h = norm(href);
  if (h === "/dashboard") {
    return p === "/dashboard";
  }
  return p === h || p.startsWith(`${h}/`);
}
