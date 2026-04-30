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
  const [scannerLine, setScannerLine] = useState<string>("");
  const [quoteLine, setQuoteLine] = useState<string>("");
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
      const p = parsed as Record<string, unknown>;
      if (p.type === "scanner_run" && typeof p.scan_type === "string") {
        setScannerLine(`Last scanner run: ${p.scan_type} (${String(p.setup_key || "")})`);
      }
      if (p.type === "quote" || p.channel === "quotes:SPY") {
        setQuoteLine(`Quote channel: ${JSON.stringify(p).slice(0, 120)}`);
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

  if (connection === "no_url") {
    return null;
  }

  return (
    <section
      style={{
        marginTop: 16,
        padding: 12,
        borderRadius: 10,
        background: "#0f172a",
        border: "1px solid #1e293b"
      }}
    >
      <h3 style={{ marginTop: 0 }}>Live</h3>
      <p style={{ margin: 0, opacity: 0.85, fontSize: 13 }}>
        WebSocket:{" "}
        {connection === "connecting" ? "connecting…" : connection === "live" ? "connected" : connection}
      </p>
      {scannerLine ? (
        <p style={{ margin: "8px 0 0", fontSize: 13 }}>{scannerLine}</p>
      ) : (
        <p style={{ margin: "8px 0 0", fontSize: 12, opacity: 0.7 }}>
          Subscribed to scanner:updates — server pushes after each scheduled scan.
        </p>
      )}
      {quoteLine ? <p style={{ margin: "6px 0 0", fontSize: 12 }}>{quoteLine}</p> : null}
    </section>
  );
}
