/**
 * Integration lock-in tests for `<AdminUsersPageClient />`.
 *
 * What we pin:
 *
 *   * On mount the page fires a list-all fetch (no `q` param) — the
 *     load-bearing behaviour the user asked for ("by default should
 *     show all the users"). If this regresses to a "type to search"
 *     empty state we want a noisy red test, not a silent UX bug.
 *   * When a response carries a `next_token` the pager renders and
 *     enables Next; Next fires another fetch carrying the token.
 *   * When a response has `next_token: null` and we're on page 0 the
 *     pager is absent (no "Page 1 of nothing" footer).
 *   * Submitting the filter form fires a fetch with `q=` and resets
 *     the page index back to 0 (we don't want to keep paginating
 *     against a stale prefix).
 *   * Upstream 5xx → render the bearish error card, not the
 *     "no users yet" empty state. The screenshot the user shared
 *     showed exactly this confusion.
 *
 * We mock the typed client (`@/lib/api/admin-users`) so we don't
 * depend on the BFF layer, and we mock the audit client because the
 * detail panel reaches for it. The wider styling / detail-panel
 * behaviour has its own tests — we don't re-cover them here.
 */

import type { ReactElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

// The Admin Users page now reads its diagnostic envelope via
// `searchUsersDiagnostic` (which returns
// `{ kind: "ok", data } | { kind: "error", error }`). We keep
// `searchUsers` as a legacy mock for any side-callers but route all
// the page's traffic through the diagnostic variant so we can pin
// both success and error code-paths.
const apiMocks = vi.hoisted(() => ({
  searchUsers: vi.fn(),
  searchUsersDiagnostic: vi.fn(),
  fetchUserDetail: vi.fn().mockResolvedValue(null),
  resetUserPassword: vi.fn(),
  addUserToGroup: vi.fn(),
  removeUserFromGroup: vi.fn(),
  userMutationErrorLabel: (code: string) => `mock:${code}`,
  // Real implementation re-exported so `AdminApiErrorCard` rendering
  // stays untouched in tests — only the network surface is mocked.
  classifyAdminReadStatus: (status: number, fallback: string) => ({
    code: status === 404 ? "not_deployed" : status === 403 ? "forbidden" : "upstream_error",
    status,
    message: fallback,
    hint: "test-hint"
  })
}));

const auditMocks = vi.hoisted(() => ({
  fetchUserAuditEvents: vi.fn().mockResolvedValue([]),
  statusCodeTone: () => "neutral" as const
}));

vi.mock("@/lib/api/admin-users", () => ({
  searchUsers: apiMocks.searchUsers,
  searchUsersDiagnostic: apiMocks.searchUsersDiagnostic,
  fetchUserDetail: apiMocks.fetchUserDetail,
  resetUserPassword: apiMocks.resetUserPassword,
  addUserToGroup: apiMocks.addUserToGroup,
  removeUserFromGroup: apiMocks.removeUserFromGroup,
  userMutationErrorLabel: apiMocks.userMutationErrorLabel,
  classifyAdminReadStatus: apiMocks.classifyAdminReadStatus
}));

vi.mock("@/lib/api/admin-audit", () => ({
  fetchUserAuditEvents: auditMocks.fetchUserAuditEvents,
  statusCodeTone: auditMocks.statusCodeTone
}));

import { AdminUsersPageClient } from "@/components/admin-users-page-client";
import { ThemeProvider } from "@/lib/theme-provider";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    })
  });
});

beforeEach(() => {
  Object.values(apiMocks).forEach((v) => {
    if (typeof (v as { mockReset?: () => void }).mockReset === "function") {
      (v as { mockReset: () => void }).mockReset();
    }
  });
  apiMocks.fetchUserDetail.mockResolvedValue(null);
});

afterEach(() => {
  // Belt-and-suspenders: auto-cleanup is on by default in
  // @testing-library/react v9+, but other tests in this repo call
  // cleanup() explicitly between tests, and skipping it causes the
  // multi-step pagination tests below to find stale DOM from a
  // previous test that's still pending state updates.
  cleanup();
});

function wrap(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

function row(i: number) {
  return {
    user_id: `sub-${i}`,
    username: `u${i}@x.com`,
    email: `u${i}@x.com`,
    email_verified: true,
    status: "CONFIRMED",
    enabled: true,
    created_at: "2026-05-10T00:00:00Z",
    updated_at: "2026-05-10T00:00:00Z"
  };
}

describe("<AdminUsersPageClient /> — default render", () => {
  test("fires a list-all fetch on mount (no q param)", async () => {
    apiMocks.searchUsersDiagnostic.mockResolvedValue({
      kind: "ok",
      data: {
        query: "",
        limit: 25,
        items: [row(1), row(2), row(3)],
        next_token: null
      }
    });
    wrap(<AdminUsersPageClient />);
    await waitFor(() =>
      expect(apiMocks.searchUsersDiagnostic).toHaveBeenCalledTimes(1)
    );
    // Mount call MUST be an empty-query list-all, with no page token.
    const [firstArg, options] = apiMocks.searchUsersDiagnostic.mock.calls[0];
    expect(firstArg).toBe("");
    expect(options).toMatchObject({ limit: 25, pageToken: null });
  });

  test("renders the list and no pager when next_token is null on page 0", async () => {
    apiMocks.searchUsersDiagnostic.mockResolvedValue({
      kind: "ok",
      data: {
        query: "",
        limit: 25,
        items: [row(1), row(2)],
        next_token: null
      }
    });
    wrap(<AdminUsersPageClient />);
    await waitFor(() =>
      expect(screen.getByTestId("admin-users-result-list")).toBeTruthy()
    );
    // No pagination state to navigate — pager must not render.
    expect(screen.queryByTestId("admin-users-pager")).toBeNull();
  });

  test("renders pager when next_token is present, even on page 0", async () => {
    apiMocks.searchUsersDiagnostic.mockResolvedValue({
      kind: "ok",
      data: {
        query: "",
        limit: 25,
        items: Array.from({ length: 25 }, (_, i) => row(i)),
        next_token: "tok-2"
      }
    });
    wrap(<AdminUsersPageClient />);
    await waitFor(() =>
      expect(screen.getByTestId("admin-users-pager")).toBeTruthy()
    );
    expect(
      screen.getByTestId("admin-users-pager").getAttribute("data-has-next")
    ).toBe("true");
    expect(
      screen.getByTestId("admin-users-pager").getAttribute("data-page-index")
    ).toBe("0");
  });

  test("upstream failure shows diagnostic error card, not 'empty pool'", async () => {
    // The Admin Users page now surfaces the actual HTTP status + a
    // typed hint via `<AdminApiErrorCard />` (test id
    // `admin-users-error-card`). A 404 (route not deployed) lands on
    // the `not_deployed` code with a terraform-apply hint; we lock
    // both data attributes here so a future copy edit or status
    // remap can't silently swallow the deploy signal.
    apiMocks.searchUsersDiagnostic.mockResolvedValue({
      kind: "error",
      error: {
        code: "not_deployed",
        status: 404,
        message: "The admin API isn't deployed yet on this environment.",
        hint: "Run terraform apply from /infra and redeploy the API Lambda."
      }
    });
    wrap(<AdminUsersPageClient />);
    await waitFor(() =>
      expect(screen.getByTestId("admin-users-error-card")).toBeTruthy()
    );
    const card = screen.getByTestId("admin-users-error-card");
    expect(card.getAttribute("data-error-status")).toBe("404");
    expect(card.getAttribute("data-error-code")).toBe("not_deployed");
    expect(card.textContent || "").toMatch(/terraform apply/i);
  });
});

// Local helper to wrap a payload in the diagnostic success envelope —
// keeps the per-test setup terse and identical to the old shape.
function okResponse(data: {
  query: string;
  limit: number;
  items: ReturnType<typeof row>[];
  next_token: string | null;
}) {
  return { kind: "ok" as const, data };
}

describe("<AdminUsersPageClient /> — pagination", () => {
  test("Next forwards the response's next_token and bumps the page index", async () => {
    apiMocks.searchUsersDiagnostic.mockResolvedValueOnce(
      okResponse({
        query: "",
        limit: 25,
        items: Array.from({ length: 25 }, (_, i) => row(i)),
        next_token: "tok-2"
      })
    );
    wrap(<AdminUsersPageClient />);
    await waitFor(() =>
      expect(screen.getByTestId("admin-users-pager")).toBeTruthy()
    );

    apiMocks.searchUsersDiagnostic.mockResolvedValueOnce(
      okResponse({
        query: "",
        limit: 25,
        items: Array.from({ length: 10 }, (_, i) => row(100 + i)),
        next_token: null
      })
    );
    fireEvent.click(screen.getByTestId("admin-users-pager-next"));

    await waitFor(() =>
      expect(apiMocks.searchUsersDiagnostic).toHaveBeenCalledTimes(2)
    );
    const [, secondOptions] = apiMocks.searchUsersDiagnostic.mock.calls[1];
    expect(secondOptions).toMatchObject({ pageToken: "tok-2" });
  });

  test("Prev pops the token stack and refetches with the previous token (or null on page 0)", async () => {
    apiMocks.searchUsersDiagnostic.mockResolvedValueOnce(
      okResponse({
        query: "",
        limit: 25,
        items: Array.from({ length: 25 }, (_, i) => row(i)),
        next_token: "tok-2"
      })
    );
    wrap(<AdminUsersPageClient />);
    await waitFor(() => expect(screen.getByTestId("admin-users-pager")).toBeTruthy());

    apiMocks.searchUsersDiagnostic.mockResolvedValueOnce(
      okResponse({
        query: "",
        limit: 25,
        items: Array.from({ length: 15 }, (_, i) => row(100 + i)),
        next_token: null
      })
    );
    fireEvent.click(screen.getByTestId("admin-users-pager-next"));
    await waitFor(() => expect(apiMocks.searchUsersDiagnostic).toHaveBeenCalledTimes(2));

    apiMocks.searchUsersDiagnostic.mockResolvedValueOnce(
      okResponse({
        query: "",
        limit: 25,
        items: Array.from({ length: 25 }, (_, i) => row(i)),
        next_token: "tok-2"
      })
    );
    fireEvent.click(screen.getByTestId("admin-users-pager-prev"));
    await waitFor(() => expect(apiMocks.searchUsersDiagnostic).toHaveBeenCalledTimes(3));
    const [, backOptions] = apiMocks.searchUsersDiagnostic.mock.calls[2];
    // Stack went [] -> [tok-2] -> []. Prev fetches page 0 with no token.
    expect(backOptions).toMatchObject({ pageToken: null });
  });

  test("submitting the filter form resets to page 0 and forwards q", async () => {
    apiMocks.searchUsersDiagnostic.mockResolvedValueOnce(
      okResponse({
        query: "",
        limit: 25,
        items: [row(1)],
        next_token: "tok-2"
      })
    );
    wrap(<AdminUsersPageClient />);
    await waitFor(() => expect(apiMocks.searchUsersDiagnostic).toHaveBeenCalledTimes(1));

    apiMocks.searchUsersDiagnostic.mockResolvedValueOnce(
      okResponse({
        query: "ali",
        limit: 25,
        items: [row(1)],
        next_token: null
      })
    );
    const input = screen.getByTestId("admin-users-search-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "ali" } });
    fireEvent.click(screen.getByTestId("admin-users-search-submit"));
    await waitFor(() => expect(apiMocks.searchUsersDiagnostic).toHaveBeenCalledTimes(2));

    const [secondArg, secondOptions] = apiMocks.searchUsersDiagnostic.mock.calls[1];
    expect(secondArg).toBe("ali");
    // Filter submit must reset the pager — always start at page 0
    // with no token (otherwise the new query inherits the old one's
    // pagination state which is meaningless).
    expect(secondOptions).toMatchObject({ pageToken: null });
  });

  test("Show all button appears only when a filter is active and clears it", async () => {
    apiMocks.searchUsersDiagnostic.mockResolvedValueOnce(
      okResponse({
        query: "",
        limit: 25,
        items: [row(1)],
        next_token: null
      })
    );
    wrap(<AdminUsersPageClient />);
    await waitFor(() => expect(apiMocks.searchUsersDiagnostic).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("admin-users-search-clear")).toBeNull();

    apiMocks.searchUsersDiagnostic.mockResolvedValueOnce(
      okResponse({
        query: "ali",
        limit: 25,
        items: [row(1)],
        next_token: null
      })
    );
    const input = screen.getByTestId("admin-users-search-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "ali" } });
    fireEvent.click(screen.getByTestId("admin-users-search-submit"));
    await waitFor(() =>
      expect(screen.getByTestId("admin-users-search-clear")).toBeTruthy()
    );

    apiMocks.searchUsersDiagnostic.mockResolvedValueOnce(
      okResponse({
        query: "",
        limit: 25,
        items: [row(1), row(2)],
        next_token: null
      })
    );
    fireEvent.click(screen.getByTestId("admin-users-search-clear"));
    await waitFor(() => expect(apiMocks.searchUsersDiagnostic).toHaveBeenCalledTimes(3));
    const [thirdArg] = apiMocks.searchUsersDiagnostic.mock.calls[2];
    expect(thirdArg).toBe("");
  });
});
