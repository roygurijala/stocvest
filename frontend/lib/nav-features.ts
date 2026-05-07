/**
 * UI-only flags for dashboard nav. Does not gate routes or APIs — users can still
 * open URLs directly. Flip a flag to `true` when the surface ships.
 */
export const NAV_FEATURES = {
  options: false,
  crypto: false,
  futures: false,
  /** Brokerage portfolio (`/dashboard/portfolio`). */
  brokerPortfolio: true
} as const;

export type NavFeatureKey = keyof typeof NAV_FEATURES;

export type NavItemWithFeature = {
  href: string;
  label: string;
  feature?: NavFeatureKey;
};

export function isDashboardNavItemEnabled(item: NavItemWithFeature): boolean {
  if (item.feature == null) return true;
  return NAV_FEATURES[item.feature] === true;
}
