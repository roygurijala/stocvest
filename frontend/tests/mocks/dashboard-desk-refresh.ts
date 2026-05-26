/**
 * Shared Vitest mocks for DashboardRedesign (D13 radar shell).
 * Import first in dashboard integration tests: `import "./mocks/dashboard-desk-refresh";`
 */
import { vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() })
}));

vi.mock("@/lib/hooks/use-dashboard-desk-refresh", () => ({
  useDashboardDeskRefresh: () => ({
    data: null,
    isLoading: false,
    isValidating: false,
    error: null,
    mutate: vi.fn(),
    refreshDesk: vi.fn(),
    manualRefreshBusy: false,
    canManualRefresh: true,
    cooldownRemainingMs: 0,
    cooldownLabel: null,
    refreshError: null
  })
}));
