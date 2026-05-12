/**
 * Tests for `frontend/lib/api/admin-proposals.ts` — the D10 Phase 3b typed
 * client for the admin proposal-review surface.
 *
 * The client is a thin layer over four BFF routes under
 * `/api/stocvest/admin/proposals/*`. Each BFF route proxies verbatim to the
 * upstream backend handler (`admin_proposals_*_handler` in
 * `stocvest/api/handlers/admin_proposals.py`). The contract this test pins:
 *
 * - List / detail fetchers return `null` on auth failure, malformed body, or
 *   any non-2xx response — never throw.
 * - Promote / reject return a discriminated `{ kind: "ok" | "error" }` outcome
 *   carrying the upstream HTTP status + error envelope so the UI can map
 *   404 / 409 / 500 to friendly text without re-parsing.
 * - Query / path / body construction matches what the upstream handler
 *   expects (lowercase status, encoded proposal IDs, optional `review_note`).
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  surfaceAuthErrorIfAny: vi.fn().mockResolvedValue(false)
}));

vi.mock("@/lib/auth/surface-auth-error", () => ({
  surfaceAuthErrorIfAny: mocks.surfaceAuthErrorIfAny
}));

import {
  fetchProposals,
  fetchProposalDetail,
  promoteProposal,
  rejectProposal,
  formatAccuracyLift,
  compositeWeightLabel
} from "@/lib/api/admin-proposals";

const fetchMock = vi.fn();
const ORIGINAL_FETCH = global.fetch;

beforeEach(() => {
  fetchMock.mockReset();
  mocks.surfaceAuthErrorIfAny.mockReset().mockResolvedValue(false);
  global.fetch = fetchMock as unknown as typeof global.fetch;
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
});

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers || {}) }
  });
}

function lastCall(): { url: string; init?: RequestInit } {
  const call = fetchMock.mock.calls.at(-1);
  if (!call) throw new Error("fetch was not called");
  return { url: String(call[0]), init: call[1] as RequestInit | undefined };
}

const SAMPLE_SUMMARY_ROW = {
  proposal_id: "prop-1",
  status: "pending" as const,
  created_at: "2026-05-10T00:00:00Z",
  created_by_job: "weight-proposer-weekly",
  baseline_parameter_version: "3",
  has_swing_proposal: true,
  has_day_proposal: false,
  swing_val_accuracy_lift: 0.04,
  day_val_accuracy_lift: null,
  swing_val_signal_count: 120,
  day_val_signal_count: null
};

const SAMPLE_DETAIL = {
  proposal_id: "prop-1",
  status: "pending" as const,
  created_at: "2026-05-10T00:00:00Z",
  created_by_job: "weight-proposer-weekly",
  baseline_parameter_version: "3",
  proposed_swing_composite: {
    technical_weight: 0.35,
    news_weight: 0.15,
    macro_weight: 0.1,
    sector_weight: 0.1,
    geopolitical_weight: 0.1,
    internals_weight: 0.2,
    bullish_threshold: 0.55,
    bearish_threshold: -0.55
  },
  proposed_day_composite: null,
  train_window_start: "2026-03-01T00:00:00Z",
  train_window_end: "2026-04-15T00:00:00Z",
  val_window_start: "2026-04-15T00:00:00Z",
  val_window_end: "2026-05-10T00:00:00Z",
  evidence: { val_accuracy: 0.62, val_accuracy_baseline: 0.58 },
  reviewed_at: null,
  reviewed_by: null,
  review_note: null,
  promoted_to_version: null
};

// ── fetchProposals ──────────────────────────────────────────────────────────

describe("fetchProposals", () => {
  test("defaults to no querystring and parses the list envelope", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ status: "pending", limit: 20, items: [SAMPLE_SUMMARY_ROW] })
    );
    const result = await fetchProposals();
    expect(result).not.toBeNull();
    expect(result!.status).toBe("pending");
    expect(result!.items).toHaveLength(1);
    expect(result!.items[0].proposal_id).toBe("prop-1");
    expect(lastCall().url).toBe("/api/stocvest/admin/proposals");
  });

  test("forwards status + limit query params verbatim", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ status: "promoted", limit: 50, items: [] })
    );
    await fetchProposals({ status: "promoted", limit: 50 });
    expect(lastCall().url).toBe("/api/stocvest/admin/proposals?status=promoted&limit=50");
  });

  test("returns null on 401 and notifies the auth-error surface", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 401 }));
    const result = await fetchProposals();
    expect(result).toBeNull();
    expect(mocks.surfaceAuthErrorIfAny).toHaveBeenCalledTimes(1);
  });

  test("returns null on 403 (non-admin caller) — UI hides the surface", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 403 }));
    const result = await fetchProposals();
    expect(result).toBeNull();
  });

  test("returns null on 500 (upstream failure)", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 500 }));
    const result = await fetchProposals();
    expect(result).toBeNull();
  });

  test("returns null when the body is non-JSON", async () => {
    fetchMock.mockResolvedValueOnce(new Response("not-json", { status: 200 }));
    const result = await fetchProposals();
    expect(result).toBeNull();
  });

  test("filters malformed rows out of items[] without dropping good ones", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        status: "pending",
        limit: 20,
        items: [SAMPLE_SUMMARY_ROW, { proposal_id: "bad", status: "not-a-status" }, null]
      })
    );
    const result = await fetchProposals();
    expect(result!.items).toHaveLength(1);
    expect(result!.items[0].proposal_id).toBe("prop-1");
  });

  test("coerces missing limit to the default 20", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: "pending", items: [] }));
    const result = await fetchProposals();
    expect(result!.limit).toBe(20);
  });

  test("collapses to null when the envelope's status is invalid", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: "weird", items: [] }));
    expect(await fetchProposals()).toBeNull();
  });

  test("returns null when fetch throws (network error)", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    expect(await fetchProposals()).toBeNull();
  });
});

// ── fetchProposalDetail ─────────────────────────────────────────────────────

describe("fetchProposalDetail", () => {
  test("URL-encodes the proposal_id path segment", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(SAMPLE_DETAIL));
    await fetchProposalDetail("prop/with slash");
    expect(lastCall().url).toBe("/api/stocvest/admin/proposals/prop%2Fwith%20slash");
  });

  test("parses the swing-only detail (day_composite=null preserved)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(SAMPLE_DETAIL));
    const result = await fetchProposalDetail("prop-1");
    expect(result).not.toBeNull();
    expect(result!.proposed_swing_composite?.technical_weight).toBeCloseTo(0.35);
    expect(result!.proposed_day_composite).toBeNull();
    expect(result!.evidence).toEqual({ val_accuracy: 0.62, val_accuracy_baseline: 0.58 });
  });

  test("returns null for empty / whitespace-only proposal_id (no fetch issued)", async () => {
    const r1 = await fetchProposalDetail("");
    const r2 = await fetchProposalDetail("   ");
    expect(r1).toBeNull();
    expect(r2).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("returns null on 404 (proposal not found)", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 404 }));
    expect(await fetchProposalDetail("missing")).toBeNull();
  });

  test("returns null on 401 (notifies auth surface)", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 401 }));
    expect(await fetchProposalDetail("prop-1")).toBeNull();
    expect(mocks.surfaceAuthErrorIfAny).toHaveBeenCalledTimes(1);
  });

  test("drops composite blocks missing required fields", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ...SAMPLE_DETAIL,
        proposed_swing_composite: { technical_weight: 0.5 } // missing the rest
      })
    );
    const result = await fetchProposalDetail("prop-1");
    expect(result!.proposed_swing_composite).toBeNull();
  });

  test("keeps optional threshold fields when present", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(SAMPLE_DETAIL));
    const result = await fetchProposalDetail("prop-1");
    expect(result!.proposed_swing_composite?.bullish_threshold).toBeCloseTo(0.55);
    expect(result!.proposed_swing_composite?.bearish_threshold).toBeCloseTo(-0.55);
  });
});

// ── promoteProposal ─────────────────────────────────────────────────────────

describe("promoteProposal", () => {
  const successBody = {
    success: true,
    proposal_id: "prop-1",
    new_parameter_version: "4",
    superseded_pending_ids: ["prop-2", "prop-3"],
    error: null
  };

  test("happy path returns an ok outcome with the parsed PromotionResult", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(successBody));
    const outcome = await promoteProposal("prop-1");
    expect(outcome.kind).toBe("ok");
    if (outcome.kind === "ok") {
      expect(outcome.data.new_parameter_version).toBe("4");
      expect(outcome.data.superseded_pending_ids).toEqual(["prop-2", "prop-3"]);
    }
  });

  test("posts to the encoded promote path with an empty JSON body", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(successBody));
    await promoteProposal("prop with space");
    const call = lastCall();
    expect(call.url).toBe("/api/stocvest/admin/proposals/prop%20with%20space/promote");
    expect(call.init?.method).toBe("POST");
  });

  test("upstream 409 (proposal not pending) is surfaced as an error with status + code + message", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { error: "proposal_not_pending", message: "proposal is in 'promoted' status, not 'pending'" },
        { status: 409 }
      )
    );
    const outcome = await promoteProposal("prop-1");
    expect(outcome.kind).toBe("error");
    if (outcome.kind === "error") {
      expect(outcome.status).toBe(409);
      expect(outcome.code).toBe("proposal_not_pending");
      expect(outcome.message).toBe("proposal is in 'promoted' status, not 'pending'");
    }
  });

  test("upstream 404 is surfaced with the not_found code", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: "proposal_not_found", message: "no such proposal" }, { status: 404 })
    );
    const outcome = await promoteProposal("prop-1");
    expect(outcome.kind).toBe("error");
    if (outcome.kind === "error") {
      expect(outcome.status).toBe(404);
      expect(outcome.code).toBe("proposal_not_found");
    }
  });

  test("upstream 500 with a non-JSON body returns an error with code='unknown'", async () => {
    fetchMock.mockResolvedValueOnce(new Response("oops", { status: 500 }));
    const outcome = await promoteProposal("prop-1");
    expect(outcome.kind).toBe("error");
    if (outcome.kind === "error") {
      expect(outcome.status).toBe(500);
      expect(outcome.code).toBe("unknown");
    }
  });

  test("network errors produce an error outcome with status=0", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    const outcome = await promoteProposal("prop-1");
    expect(outcome.kind).toBe("error");
    if (outcome.kind === "error") {
      expect(outcome.status).toBe(0);
      expect(outcome.code).toBe("network_error");
    }
  });

  test("malformed 200 response is reported as malformed_response with status=200", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ not: "what we expected" }));
    const outcome = await promoteProposal("prop-1");
    expect(outcome.kind).toBe("error");
    if (outcome.kind === "error") {
      expect(outcome.code).toBe("malformed_response");
      expect(outcome.status).toBe(200);
    }
  });

  test("empty proposal_id short-circuits to a bad_request error and does not call fetch", async () => {
    const outcome = await promoteProposal("");
    expect(outcome.kind).toBe("error");
    if (outcome.kind === "error") {
      expect(outcome.code).toBe("bad_request");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ── rejectProposal ──────────────────────────────────────────────────────────

describe("rejectProposal", () => {
  test("happy path returns an ok outcome with the post-rejection detail", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ...SAMPLE_DETAIL,
        status: "rejected",
        reviewed_at: "2026-05-10T01:00:00Z",
        reviewed_by: "admin-sub-1",
        review_note: "Looks risky."
      })
    );
    const outcome = await rejectProposal("prop-1", { reviewNote: "Looks risky." });
    expect(outcome.kind).toBe("ok");
    if (outcome.kind === "ok") {
      expect(outcome.data.status).toBe("rejected");
      expect(outcome.data.review_note).toBe("Looks risky.");
    }
  });

  test("omits review_note from the body when no note is provided", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ...SAMPLE_DETAIL, status: "rejected", reviewed_by: "admin-sub-1" })
    );
    await rejectProposal("prop-1");
    const body = JSON.parse((lastCall().init?.body as string) ?? "{}");
    expect(body).toEqual({});
  });

  test("trims whitespace from review_note before sending", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ...SAMPLE_DETAIL, status: "rejected", review_note: "Stale data." })
    );
    await rejectProposal("prop-1", { reviewNote: "  Stale data.  " });
    const body = JSON.parse((lastCall().init?.body as string) ?? "{}");
    expect(body).toEqual({ review_note: "Stale data." });
  });

  test("omits an empty / whitespace-only review_note from the body", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ...SAMPLE_DETAIL, status: "rejected" })
    );
    await rejectProposal("prop-1", { reviewNote: "   " });
    const body = JSON.parse((lastCall().init?.body as string) ?? "{}");
    expect(body).toEqual({});
  });

  test("upstream 409 is surfaced as an error outcome", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { error: "proposal_not_pending", message: "already rejected" },
        { status: 409 }
      )
    );
    const outcome = await rejectProposal("prop-1");
    expect(outcome.kind).toBe("error");
    if (outcome.kind === "error") {
      expect(outcome.status).toBe(409);
      expect(outcome.code).toBe("proposal_not_pending");
    }
  });

  test("empty proposal_id short-circuits without calling fetch", async () => {
    const outcome = await rejectProposal("   ");
    expect(outcome.kind).toBe("error");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("malformed success body returns a malformed_response error", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ what: "is this" }));
    const outcome = await rejectProposal("prop-1");
    expect(outcome.kind).toBe("error");
    if (outcome.kind === "error") {
      expect(outcome.code).toBe("malformed_response");
    }
  });
});

// ── Display helpers ─────────────────────────────────────────────────────────

describe("formatAccuracyLift", () => {
  test("renders a positive fraction with a '+' sign and 1 decimal pp", () => {
    expect(formatAccuracyLift(0.052)).toBe("+5.2pp");
  });

  test("renders a negative fraction without an extra sign", () => {
    expect(formatAccuracyLift(-0.031)).toBe("-3.1pp");
  });

  test("zero is rendered as '0.0pp' (not '+0.0pp')", () => {
    expect(formatAccuracyLift(0)).toBe("0.0pp");
  });

  test("null collapses to the em-dash convention used across the dashboard", () => {
    expect(formatAccuracyLift(null)).toBe("—");
  });

  test("non-finite numbers also collapse to em-dash", () => {
    expect(formatAccuracyLift(Number.NaN)).toBe("—");
    expect(formatAccuracyLift(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

describe("compositeWeightLabel", () => {
  test("renders human-readable labels for every documented composite key", () => {
    expect(compositeWeightLabel("technical_weight")).toBe("Technical");
    expect(compositeWeightLabel("news_weight")).toBe("News");
    expect(compositeWeightLabel("macro_weight")).toBe("Macro");
    expect(compositeWeightLabel("sector_weight")).toBe("Sector");
    expect(compositeWeightLabel("geopolitical_weight")).toBe("Geopolitical");
    expect(compositeWeightLabel("internals_weight")).toBe("Internals");
    expect(compositeWeightLabel("bullish_threshold")).toBe("Bullish threshold");
    expect(compositeWeightLabel("bearish_threshold")).toBe("Bearish threshold");
  });
});
