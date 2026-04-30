"use client";

import { useEffect, useRef, useState } from "react";

function browserWsBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_STOCVEST_WS_URL?.trim() || "";
  if (!raw) return "";
  return raw.replace(/^https:\/\//i, "wss://");
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

/**
 * Maintains a WebSocket to API Gateway for ``scanner:updates`` and ``quotes:SPY`` (quote fan-out is backend TBD).
 */
export function DashboardRealtime() {
  const [connection, setConnection] = useState<"off" | "connecting" | "live" | "error" | "no_url">("off");
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const base = browserWsBaseUrl();
    if (!base) {
      setConnection("no_url");
      return;
    }
    setConnection("connecting");
    const ws = new WebSocket(base);
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

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, []);

  if (connection === "no_url" || connection === "error" || connection === "off") {
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
