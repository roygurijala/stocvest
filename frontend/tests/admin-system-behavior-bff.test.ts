/**
 * BFF proxy for GET /v1/admin/system-behavior — forwards mode + days.
 */

import { describe, expect, test, vi, beforeEach } from "vitest";

const authedFetch = vi.hoisted(() => vi.fn());

vi.mock("@/lib/bff/stocvest-authed", () => ({
  stocvestAuthedFetch: authedFetch
}));

import { GET } from "@/app/api/stocvest/admin/system-behavior/route";

describe("admin system-behavior BFF", () => {
  beforeEach(() => {
    authedFetch.mockReset();
    authedFetch.mockResolvedValue(
      new Response(JSON.stringify({ scope: "platform", transition_count: 0 }), { status: 200 })
    );
  });

  test("forwards mode and days to upstream", async () => {
    const req = {
      nextUrl: new URL("http://localhost/api/stocvest/admin/system-behavior?mode=day&days=14")
    } as Parameters<typeof GET>[0];

    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(authedFetch).toHaveBeenCalledTimes(1);
    const [path, init] = authedFetch.mock.calls[0] as [string, RequestInit];
    expect(path).toContain("mode=day");
    expect(path).toContain("days=14");
    expect(init?.method).toBe("GET");
  });
});
