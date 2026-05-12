"use client";

import { surfaceAuthErrorIfAny } from "@/lib/auth/surface-auth-error";

/**
 * Typed client for `GET /v1/admin/parameters/current`.
 *
 * Returns the full live SignalParameters payload (the JSON that's
 * currently in Secrets Manager). Used by the admin parameters page to
 * render an at-a-glance readable view of every weight / threshold /
 * lookback that drives the signal engines.
 *
 * The shape mirrors :func:`signal_parameters_to_dict` so we keep
 * `parameters` as an opaque `Record<string, unknown>` — the page
 * walks the keys it knows about and skips the rest. This way a backend
 * field-add doesn't break the frontend; the new keys just don't render
 * until the page is updated to know about them.
 */

export interface CurrentParametersResponse {
  version: string;
  created_at: string;
  notes: string;
  parameters: Record<string, unknown>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseStr(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export async function fetchCurrentParameters(): Promise<CurrentParametersResponse | null> {
  try {
    const response = await fetch("/api/stocvest/admin/parameters/current", {
      method: "GET",
      credentials: "include",
      cache: "no-store"
    });
    if (response.status === 401) {
      void surfaceAuthErrorIfAny(response);
      return null;
    }
    if (!response.ok) return null;
    const data = (await response.json()) as unknown;
    if (!isRecord(data)) return null;
    return {
      version: parseStr(data.version),
      created_at: parseStr(data.created_at),
      notes: parseStr(data.notes),
      parameters: isRecord(data.parameters) ? data.parameters : {}
    };
  } catch {
    return null;
  }
}
