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

const apiMocks = vi.hoisted(() => ({
  searchUsers: vi.fn(),
  fetchUserDetail: vi.fn().mockResolvedValue(null),
  resetUserPassword: vi.fn(),
  addUserToGroup: vi.fn(),
  removeUserFromGroup: vi.fn(),
  userMutationErrorLabel: (code: string) => `mock:${code}`
}));

const auditMocks = vi.hoisted(() => ({
  fetchUserAuditEvents: vi.fn().mockResolvedValue([]),
  statusCodeTone: () => "neutral" as const
}));

vi.mock("@/lib/api/admin-users", () => ({
  searchUsers: apiMocks.searchUsers,
  fetchUserDetail: apiMocks.fetchUserDetail,
  resetUserPassword: apiMocks.resetUserPassword,
  addUserToGroup: apiMocks.addUserToGroup,
  removeUserFromGroup: apiMocks.removeUserFromGroup,
  userMutationErrorLabel: apiMocks.userMutationErrorLabel
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
    apiMocks.searchUsers.mockResolvedValue({
      query: "",
      limit: 25,
      items: [row(1), row(2), row(3)],
      next_token: null
    });
    wrap(<AdminUsersPageClient />);
    await waitFor(() =>
      expect(apiMocks.searchUsers).toHaveBeenCalledTimes(1)
    );
    // Mount call MUST be an empty-query list-all, with no page token.
    const [firstArg, options] = apiMocks.searchUsers.mock.calls[0];
    expect(firstArg).toBe("");
    expect(options).toMatchObject({ limit: 25, pageToken: null });
  });

  test("renders the list and no pager when next_token is null on page 0", async () => {
    apiMocks.searchUsers.mockResolvedValue({
      query: "",
      limit: 25,
      items: [row(1), row(2)],
      next_token: null
    });
    wrap(<AdminUsersPageClient />);
    await waitFor(() =>
      expect(screen.getByTestId("admin-users-result-list")).toBeTruthy()
    );
    // No pagination state to navigate — pager must not render.
    expect(screen.queryByTestId("admin-users-pager")).toBeNull();
  });

  test("renders pager when next_token is present, even on page 0", async () => {
    apiMocks.searchUsers.mockResolvedValue({
      query: "",
      limit: 25,
      items: Array.from({ length: 25 }, (_, i) => row(i)),
      next_token: "tok-2"
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

  test("upstream failure shows bearish error, not 'empty pool'", async () => {
    apiMocks.searchUsers.mockResolvedValue(null);
    wrap(<AdminUsersPageClient />);
    await waitFor(() =>
      expect(screen.getByTestId("admin-users-empty")).toBeTruthy()
    );
    const empty = screen.getByTestId("admin-users-empty");
    expect(empty.getAttribute("data-tone")).toBe("bearish");
    expect(empty.textContent || "").toMatch(/Failed to load users/i);
  });
});

describe("<AdminUsersPageClient /> — pagination", () => {
  test("Next forwards the response's next_token and bumps the page index", async () => {
    apiMocks.searchUsers.mockResolvedValueOnce({
      query: "",
      limit: 25,
      items: Array.from({ length: 25 }, (_, i) => row(i)),
      next_token: "tok-2"
    });
    wrap(<AdminUsersPageClient />);
    await waitFor(() =>
      expect(screen.getByTestId("admin-users-pager")).toBeTruthy()
    );

    apiMocks.searchUsers.mockResolvedValueOnce({
      query: "",
      limit: 25,
      items: Array.from({ length: 10 }, (_, i) => row(100 + i)),
      next_token: null
    });
    fireEvent.click(screen.getByTestId("admin-users-pager-next"));

    await waitFor(() =>
      expect(apiMocks.searchUsers).toHaveBeenCalledTimes(2)
    );
    const [, secondOptions] = apiMocks.searchUsers.mock.calls[1];
    expect(secondOptions).toMatchObject({ pageToken: "tok-2" });
  });

  test("Prev pops the token stack and refetches with the previous token (or null on page 0)", async () => {
    apiMocks.searchUsers.mockResolvedValueOnce({
      query: "",
      limit: 25,
      items: Array.from({ length: 25 }, (_, i) => row(i)),
      next_token: "tok-2"
    });
    wrap(<AdminUsersPageClient />);
    await waitFor(() => expect(screen.getByTestId("admin-users-pager")).toBeTruthy());

    apiMocks.searchUsers.mockResolvedValueOnce({
      query: "",
      limit: 25,
      items: Array.from({ length: 15 }, (_, i) => row(100 + i)),
      next_token: null
    });
    fireEvent.click(screen.getByTestId("admin-users-pager-next"));
    await waitFor(() => expect(apiMocks.searchUsers).toHaveBeenCalledTimes(2));

    apiMocks.searchUsers.mockResolvedValueOnce({
      query: "",
      limit: 25,
      items: Array.from({ length: 25 }, (_, i) => row(i)),
      next_token: "tok-2"
    });
    fireEvent.click(screen.getByTestId("admin-users-pager-prev"));
    await waitFor(() => expect(apiMocks.searchUsers).toHaveBeenCalledTimes(3));
    const [, backOptions] = apiMocks.searchUsers.mock.calls[2];
    // Stack went [] -> [tok-2] -> []. Prev fetches page 0 with no token.
    expect(backOptions).toMatchObject({ pageToken: null });
  });

  test("submitting the filter form resets to page 0 and forwards q", async () => {
    apiMocks.searchUsers.mockResolvedValueOnce({
      query: "",
      limit: 25,
      items: [row(1)],
      next_token: "tok-2"
    });
    wrap(<AdminUsersPageClient />);
    await waitFor(() => expect(apiMocks.searchUsers).toHaveBeenCalledTimes(1));

    apiMocks.searchUsers.mockResolvedValueOnce({
      query: "ali",
      limit: 25,
      items: [row(1)],
      next_token: null
    });
    const input = screen.getByTestId("admin-users-search-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "ali" } });
    fireEvent.click(screen.getByTestId("admin-users-search-submit"));
    await waitFor(() => expect(apiMocks.searchUsers).toHaveBeenCalledTimes(2));

    const [secondArg, secondOptions] = apiMocks.searchUsers.mock.calls[1];
    expect(secondArg).toBe("ali");
    // Filter submit must reset the pager — always start at page 0
    // with no token (otherwise the new query inherits the old one's
    // pagination state which is meaningless).
    expect(secondOptions).toMatchObject({ pageToken: null });
  });

  test("Show all button appears only when a filter is active and clears it", async () => {
    apiMocks.searchUsers.mockResolvedValueOnce({
      query: "",
      limit: 25,
      items: [row(1)],
      next_token: null
    });
    wrap(<AdminUsersPageClient />);
    await waitFor(() => expect(apiMocks.searchUsers).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("admin-users-search-clear")).toBeNull();

    apiMocks.searchUsers.mockResolvedValueOnce({
      query: "ali",
      limit: 25,
      items: [row(1)],
      next_token: null
    });
    const input = screen.getByTestId("admin-users-search-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "ali" } });
    fireEvent.click(screen.getByTestId("admin-users-search-submit"));
    await waitFor(() =>
      expect(screen.getByTestId("admin-users-search-clear")).toBeTruthy()
    );

    apiMocks.searchUsers.mockResolvedValueOnce({
      query: "",
      limit: 25,
      items: [row(1), row(2)],
      next_token: null
    });
    fireEvent.click(screen.getByTestId("admin-users-search-clear"));
    await waitFor(() => expect(apiMocks.searchUsers).toHaveBeenCalledTimes(3));
    const [thirdArg] = apiMocks.searchUsers.mock.calls[2];
    expect(thirdArg).toBe("");
  });
});
