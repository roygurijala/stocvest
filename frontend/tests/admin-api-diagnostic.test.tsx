/**
 * Lock-in tests for the typed admin API diagnostic envelope.
 *
 * The Admin Users page used to swallow every fetch failure (401 /
 * 403 / 404 / 5xx) and render a generic "Failed to load users."
 * line, forcing operators to crack open DevTools to see the actual
 * status. A 404 from a route that hadn't been deployed yet looked
 * identical to a 500 from a runtime crash, which is exactly the
 * scenario this regression set guards against.
 *
 * Two surfaces under test:
 *
 *   1. `classifyAdminReadStatus(status, fallback)` — pure mapper
 *      from HTTP status to `{ code, status, message, hint }`. Every
 *      admin page that surfaces a diagnostic envelope routes through
 *      this function, so the copy here is the single source of truth
 *      for "what does HTTP 404 mean for an admin operator".
 *
 *   2. `AdminApiErrorCard` — the visual component that renders the
 *      envelope. We pin that it exposes the raw status + code as
 *      data attributes (so smoke tests can scrape them) and that
 *      the retry button is wired when an `onRetry` prop is provided.
 */

import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import {
  classifyAdminReadStatus,
  type AdminApiReadError
} from "@/lib/api/admin-users";
import { AdminApiErrorCard } from "@/components/admin/admin-api-error-card";
import { ThemeProvider } from "@/lib/theme-provider";

afterEach(() => cleanup());

describe("classifyAdminReadStatus", () => {
  test("test_404_is_classified_as_not_deployed_with_terraform_hint", () => {
    // The exact failure mode the user hit: BFF returns 404 because
    // the upstream API Gateway route hasn't been deployed yet. The
    // hint MUST point at terraform apply — that's the only correct
    // remediation, and any other copy leaves the operator guessing.
    const out = classifyAdminReadStatus(404, "Request failed.");
    expect(out.code).toBe("not_deployed");
    expect(out.status).toBe(404);
    expect(out.hint.toLowerCase()).toContain("terraform apply");
  });

  test("test_403_is_classified_as_forbidden_with_signout_hint", () => {
    // After a fresh grant_admin run the user's existing JWT lacks
    // `cognito:groups`. They MUST sign out and back in to refresh
    // the token; the hint should say so explicitly.
    const out = classifyAdminReadStatus(403, "Request failed.");
    expect(out.code).toBe("forbidden");
    expect(out.status).toBe(403);
    expect(out.hint.toLowerCase()).toContain("sign out");
  });

  test("test_401_is_classified_as_unauthenticated", () => {
    const out = classifyAdminReadStatus(401, "Request failed.");
    expect(out.code).toBe("unauthenticated");
    expect(out.status).toBe(401);
  });

  test("test_5xx_codes_collapse_to_upstream_error_with_lambda_logs_hint", () => {
    // 500 / 502 / 503 / 504 all share the same operator action:
    // check the Lambda logs in CloudWatch. We don't differentiate
    // them in the hint because the operator's next step is the same.
    for (const status of [500, 502, 503, 504]) {
      const out = classifyAdminReadStatus(status, "Request failed.");
      expect(out.code).toBe("upstream_error");
      expect(out.status).toBe(status);
      expect(out.hint.toLowerCase()).toContain("cloudwatch");
    }
  });

  test("test_unknown_status_falls_back_to_upstream_error", () => {
    const out = classifyAdminReadStatus(418, "I'm a teapot.");
    expect(out.code).toBe("upstream_error");
    expect(out.message).toBe("I'm a teapot.");
  });
});

describe("AdminApiErrorCard rendering", () => {
  function withTheme(node: React.ReactElement) {
    return render(<ThemeProvider>{node}</ThemeProvider>);
  }

  const sampleError: AdminApiReadError = {
    code: "not_deployed",
    status: 404,
    message: "The admin API isn't deployed yet on this environment.",
    hint: "Run terraform apply from /infra and redeploy the API Lambda."
  };

  test("test_renders_status_code_and_message", () => {
    withTheme(<AdminApiErrorCard error={sampleError} />);
    const card = screen.getByTestId("admin-api-error-card");
    expect(card.getAttribute("data-error-status")).toBe("404");
    expect(card.getAttribute("data-error-code")).toBe("not_deployed");
    expect(card.textContent).toContain("HTTP 404");
    expect(card.textContent?.toLowerCase()).toMatch(/(isn't|not)\s+deployed/);
    expect(card.textContent).toContain("terraform apply");
  });

  test("test_retry_button_is_only_rendered_when_on_retry_is_provided", () => {
    const { rerender } = withTheme(<AdminApiErrorCard error={sampleError} />);
    expect(screen.queryByText(/retry/i)).toBeNull();
    const onRetry = vi.fn();
    rerender(
      <ThemeProvider>
        <AdminApiErrorCard error={sampleError} onRetry={onRetry} />
      </ThemeProvider>
    );
    const button = screen.getByTestId("admin-api-error-card-retry");
    fireEvent.click(button);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  test("test_custom_test_id_propagates_to_retry_button", () => {
    const onRetry = vi.fn();
    withTheme(
      <AdminApiErrorCard error={sampleError} onRetry={onRetry} testId="audit-error" />
    );
    expect(screen.getByTestId("audit-error")).toBeInTheDocument();
    expect(screen.getByTestId("audit-error-retry")).toBeInTheDocument();
  });
});
