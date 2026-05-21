"use client";

import { useEffect, useRef, useState } from "react";
import { readWsTokenFromDocumentCookie } from "@/lib/auth/ws-token-cookie";

function browserWsBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_STOCVEST_WS_URL?.trim() || "";
  if (!raw) return "";
  return raw.replace(/^https:\/\//i, "wss://");
}

/** API Gateway v2 WebSocket requires the stage in the URL path; bare host + "/?token=" connects to the wrong route and fails. */
const EXECUTE_API_WS_HOST = /\.execute-api\.[a-z0-9-]+\.amazonaws\.com$/i;

function ensureApiGatewayWebSocketStagePath(baseWss: string): string {
  const withWss = baseWss.startsWith("wss://") ? baseWss : `wss://${baseWss}`;
  try {
    const u = new URL(withWss);
    if (!EXECUTE_API_WS_HOST.test(u.hostname)) {
      return withWss;
    }
    const segments = u.pathname
      .replace(/\/+$/, "")
      .split("/")
      .filter(Boolean);
    if (segments.length === 0) {
      u.pathname = "/$default";
    }
    return u.toString().replace(/\/+$/, "");
  } catch {
    return baseWss;
  }
}

function buildWebSocketUrlWithToken(baseWss: string, token: string): string {
  const normalized = ensureApiGatewayWebSocketStagePath(
    baseWss.startsWith("wss://") ? baseWss : `wss://${baseWss}`
  );
  const u = new URL(normalized);
  u.searchParams.set("token", token);
  return u.toString();
}

function parseWsPayload(raw: string): unknown {
  try {
    const outer = JSON.parse(raw) as { body?: string };
    if (typeof outer?.body === "string") {
      return JSON.parse(outer.body);
    }
    return outer;
  } catch {
    return null;
  }
}

type ConnectionState =
  | "silent"
  | "connecting"
  | "live"
  | "error"
  | "off";

/**
 * WebSocket to API Gateway: JWT cannot be sent as a header from the browser; pass `token` query param.
 * IdToken is read from the non-httpOnly mirror cookie (see `setSessionTokenCookiesFromIdToken`).
 */
export function DashboardRealtime() {
  const [connection, setConnection] = useState<ConnectionState>("silent");
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const base = browserWsBaseUrl();
    const token = readWsTokenFromDocumentCookie();
    if (!base || !token) {
      setConnection("silent");
      return;
    }
    const wsUrl = buildWebSocketUrlWithToken(base, token);
    setConnection("connecting");
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnection("live");
      ws.send(JSON.stringify({ action: "subscribe", channel: "scanner:updates" }));
      ws.send(JSON.stringify({ action: "subscribe", channel: "quotes:SPY" }));
    };

    ws.onmessage = (ev: MessageEvent<string>) => {
      const parsed = parseWsPayload(ev.data);
      if (!parsed || typeof parsed !== "object") {
        return;
      }
    };

    ws.onerror = () => {
      setConnection("error");
    };

    ws.onclose = () => {
      setConnection((prev) => (prev === "live" ? "off" : prev));
      wsRef.current = null;
    };

    // Prevent stray close events from surfacing as unhandled runtime errors in production.
    ws.addEventListener("error", (ev) => {
      ev.stopPropagation();
    });

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, []);

  if (connection === "silent") {
    return (
      <span
        aria-hidden
        title=""
        style={{
          width: 8,
          height: 8,
          borderRadius: "999px",
          background: "#6b7280",
          display: "inline-block"
        }}
      />
    );
  }

  if (connection === "error" || connection === "off") {
    return null;
  }

  const dotColor = connection === "live" ? "#22c55e" : "#9ca3af";
  const label = connection === "live" ? "Live" : "Connecting...";

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span
        aria-label="Realtime connection status"
        title={connection === "live" ? "Realtime connected" : "Realtime connecting"}
        style={{
          width: 8,
          height: 8,
          borderRadius: "999px",
          background: dotColor
        }}
      />
      <span style={{ fontSize: 12, color: "#94a3b8" }}>{label}</span>
    </div>
  );
}
