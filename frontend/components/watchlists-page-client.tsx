"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CuteLoader } from "@/components/cute-loader";
import { usePublishAssistantContext } from "@/lib/assistant/context";
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

type WatchlistRow = {
  watchlist_id: string;
  name: string;
  symbols: string[];
  is_default: boolean;
};

const QUICK = ["SPY", "QQQ", "AAPL", "NVDA", "TSLA"];

export function WatchlistsPageClient() {
  const { colors, theme } = useTheme();
  const [rows, setRows] = useState<WatchlistRow[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [addInput, setAddInput] = useState("");
  const [symErr, setSymErr] = useState<string | null>(null);
  const [rename, setRename] = useState<string | null>(null);

  usePublishAssistantContext({ page: "dashboard/watchlists" });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/stocvest/watchlists", { cache: "no-store" });
      const data = (await res.json()) as { watchlists?: WatchlistRow[]; message?: string };
      if (!res.ok) throw new Error(data.message || "Failed to load watchlists");
      const list = data.watchlists ?? [];
      setRows(list);
      setActiveId((id) => id && list.some((w) => w.watchlist_id === id) ? id : list[0]?.watchlist_id ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const active = useMemo(() => rows.find((w) => w.watchlist_id === activeId) ?? rows[0] ?? null, [rows, activeId]);

  async function patchWatchlist(id: string, body: Record<string, unknown>) {
    const res = await fetch(`/api/stocvest/watchlists/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as { message?: string }).message || "Update failed");
    return data as WatchlistRow;
  }

  async function createWatchlist() {
    const name = newName.trim() || "New Watchlist";
    const res = await fetch("/api/stocvest/watchlists", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, symbols: [], is_default: rows.length === 0 })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError((data as { message?: string }).message || "Could not create");
      return;
    }
    setNewOpen(false);
    setNewName("");
    await load();
    setActiveId((data as WatchlistRow).watchlist_id);
  }

  async function addSymbol(symRaw: string) {
    if (!active) return;
    const sym = symRaw.trim().toUpperCase();
    setSymErr(null);
    if (!sym || sym.length > 6 || !/^[A-Z]+$/.test(sym)) {
      setSymErr("Use 1–6 uppercase letters.");
      return;
    }
    const prev = rows;
    const optimistic = rows.map((w) =>
      w.watchlist_id === active.watchlist_id ? { ...w, symbols: w.symbols.includes(sym) ? w.symbols : [...w.symbols, sym] } : w
    );
    setRows(optimistic);
    try {
      const res = await fetch(`/api/stocvest/watchlists/${encodeURIComponent(active.watchlist_id)}/symbols`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ symbol: sym })
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 400) {
        setRows(prev);
        setSymErr((data as { message?: string }).message || "Limit reached");
        return;
      }
      if (!res.ok) {
        setRows(prev);
        setSymErr("Add failed");
        return;
      }
      setRows((r) => r.map((w) => (w.watchlist_id === active.watchlist_id ? (data as WatchlistRow) : w)));
    } catch {
      setRows(prev);
      setSymErr("Network error");
    }
    setAddInput("");
  }

  async function removeSymbol(sym: string) {
    if (!active) return;
    const prev = rows;
    setRows((r) =>
      r.map((w) => (w.watchlist_id === active.watchlist_id ? { ...w, symbols: w.symbols.filter((s) => s !== sym) } : w))
    );
    try {
      const res = await fetch(
        `/api/stocvest/watchlists/${encodeURIComponent(active.watchlist_id)}/symbols/${encodeURIComponent(sym)}`,
        { method: "DELETE" }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRows(prev);
        setError((data as { message?: string }).message || "Remove failed");
        return;
      }
      setRows((r) => r.map((w) => (w.watchlist_id === active.watchlist_id ? (data as WatchlistRow) : w)));
    } catch {
      setRows(prev);
    }
  }

  async function setDefault() {
    if (!active) return;
    await patchWatchlist(active.watchlist_id, { is_default: true });
    await load();
  }

  async function deleteList() {
    if (!active) return;
    if (!window.confirm("Delete this watchlist?")) return;
    try {
      const res = await fetch(`/api/stocvest/watchlists/${encodeURIComponent(active.watchlist_id)}`, {
        method: "DELETE"
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((data as { message?: string }).message || "Cannot delete");
        return;
      }
      await load();
    } catch {
      setError("Delete failed");
    }
  }

  async function saveRename(name: string) {
    if (!active) return;
    await patchWatchlist(active.watchlist_id, { name });
    setRename(null);
    await load();
  }

  if (loading) {
    return <CuteLoader label="Loading watchlists" sublabel="Syncing your symbols and groups" compact />;
  }
  if (error && !rows.length) {
    return <p style={{ color: colors.bearish }}>{error}</p>;
  }

  return (
    <div style={{ display: "grid", gap: spacing[4] }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: spacing[3] }}>
        <h1 style={{ margin: 0, fontSize: typography.scale["2xl"], color: colors.text }}>Watchlists</h1>
        <button
          type="button"
          className="min-h-11 rounded-md px-4"
          style={{ background: colors.accent, color: "#041018", fontWeight: 600, border: "none", cursor: "pointer" }}
          onClick={() => setNewOpen((v) => !v)}
        >
          + New Watchlist
        </button>
      </div>

      {newOpen ? (
        <div
          className={surfaceGlowClassName}
          style={{
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: borderRadius.lg,
            padding: spacing[3],
            display: "flex",
            flexWrap: "wrap",
            gap: spacing[2],
            alignItems: "center"
          }}
        >
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Watchlist name"
            className="min-h-11 rounded-md border px-3"
            style={{ borderColor: colors.border, background: colors.surfaceMuted, color: colors.text, minWidth: 200 }}
          />
          <button type="button" className="min-h-11 rounded-md px-3" style={{ border: `1px solid ${colors.border}` }} onClick={() => void createWatchlist()}>
            Create
          </button>
        </div>
      ) : null}

      {rows.length > 1 ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: spacing[2] }}>
          {rows.map((w) => {
            const isAct = active?.watchlist_id === w.watchlist_id;
            return (
              <button
                key={w.watchlist_id}
                type="button"
                onClick={() => setActiveId(w.watchlist_id)}
                style={{
                  borderRadius: borderRadius.md,
                  padding: `${spacing[2]} ${spacing[3]}`,
                  border: `1px solid ${isAct ? "rgba(0,180,255,0.45)" : colors.border}`,
                  background: isAct ? "rgba(0,180,255,0.1)" : colors.surface,
                  color: isAct ? colors.accent : colors.text,
                  cursor: "pointer",
                  fontWeight: isAct ? 700 : 500
                }}
              >
                {w.is_default ? "★ " : ""}
                {w.name}
              </button>
            );
          })}
        </div>
      ) : null}

      {active ? (
        <article
          className={surfaceGlowClassName}
          style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: borderRadius.xl, padding: spacing[4] }}
        >
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: spacing[3], alignItems: "flex-start" }}>
            <div>
              {rename === active.watchlist_id ? (
                <input
                  autoFocus
                  defaultValue={active.name}
                  onBlur={(e) => void saveRename(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  }}
                  className="min-h-11 rounded-md border px-2 text-lg font-semibold"
                  style={{ borderColor: colors.border, color: colors.text }}
                />
              ) : (
                <h2
                  style={{ margin: 0, cursor: "pointer", color: colors.text }}
                  onClick={() => setRename(active.watchlist_id)}
                  title="Click to rename"
                >
                  {active.name}
                </h2>
              )}
              <p style={{ margin: spacing[1] + " 0 0", color: colors.textMuted, fontSize: typography.scale.sm }}>
                {active.symbols.length} symbols
                {active.is_default ? (
                  <span style={{ marginLeft: spacing[2], color: "#00b4ff" }}>★ Default</span>
                ) : null}
              </p>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: spacing[2] }}>
              {!active.is_default ? (
                <button type="button" className="min-h-11 rounded-md border px-3" style={{ borderColor: colors.border }} onClick={() => void setDefault()}>
                  Set as default
                </button>
              ) : null}
              <button type="button" className="min-h-11 rounded-md border px-3" style={{ borderColor: colors.bearish, color: colors.bearish }} onClick={() => void deleteList()}>
                Delete
              </button>
            </div>
          </div>

          <div
            style={{
              marginTop: spacing[3],
              display: "flex",
              flexWrap: "wrap",
              gap: spacing[2],
              alignItems: "center",
              padding: spacing[3],
              borderRadius: borderRadius.lg,
              background: colors.surfaceMuted,
              border: `1px solid ${colors.border}`
            }}
          >
            <input
              value={addInput}
              onChange={(e) => setAddInput(e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6))}
              onKeyDown={(e) => {
                if (e.key === "Enter") void addSymbol(addInput);
              }}
              placeholder="Add ticker…"
              className="min-h-11 flex-1 rounded-md border px-3"
              style={{
                borderColor: colors.border,
                minWidth: 120,
                maxWidth: 280,
                background: colors.surface,
                color: colors.text,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                letterSpacing: "0.06em",
                fontWeight: 600
              }}
            />
            <button
              type="button"
              className="min-h-11 shrink-0 rounded-md px-4"
              style={{
                background: colors.accent,
                color: theme === "light" ? "#ffffff" : "#041018",
                border: "none",
                fontWeight: 700,
                cursor: "pointer"
              }}
              onClick={() => void addSymbol(addInput)}
            >
              Add
            </button>
            {symErr ? (
              <span style={{ color: colors.bearish, fontSize: typography.scale.sm, width: "100%" }}>{symErr}</span>
            ) : null}
          </div>

          <div style={{ marginTop: spacing[4] }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: spacing[2], marginBottom: spacing[2] }}>
              <p style={{ margin: 0, fontSize: typography.scale.xs, fontWeight: 700, letterSpacing: "0.12em", color: colors.textMuted }}>
                SYMBOLS
              </p>
              <span style={{ fontSize: typography.scale.xs, color: colors.textMuted }}>{active.symbols.length} total</span>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(104px, 1fr))",
                gap: spacing[2],
                padding: spacing[3],
                borderRadius: borderRadius.lg,
                background: colors.background,
                border: `1px solid ${colors.border}`,
                minHeight: active.symbols.length === 0 ? 120 : undefined
              }}
            >
              {active.symbols.length === 0 ? (
                <div style={{ gridColumn: "1 / -1" }}>
                  <p style={{ color: colors.textMuted, margin: `0 0 ${spacing[3]}`, fontSize: typography.scale.sm }}>
                    No symbols yet. Type a ticker above or tap a popular name to add it.
                  </p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: spacing[2] }}>
                    {QUICK.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => void addSymbol(s)}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          minHeight: 40,
                          padding: `0 ${spacing[3]}`,
                          borderRadius: borderRadius.md,
                          border: `1px dashed ${colors.accent}`,
                          background: "rgba(59,130,246,0.08)",
                          color: colors.text,
                          cursor: "pointer",
                          fontSize: typography.scale.sm,
                          fontWeight: 700,
                          letterSpacing: "0.08em"
                        }}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                active.symbols.map((s) => (
                  <div
                    key={s}
                    className="tabular-nums"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: spacing[2],
                      padding: `${spacing[2]} ${spacing[3]}`,
                      borderRadius: borderRadius.md,
                      background: colors.surface,
                      border: `1px solid ${colors.border}`,
                      fontSize: typography.scale.base,
                      fontWeight: 700,
                      letterSpacing: "0.06em",
                      color: colors.text
                    }}
                  >
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span>{s}</span>
                      <Link
                        href={`/dashboard/signals?symbol=${encodeURIComponent(s)}&ref=watchlist`}
                        className="text-[10px] font-semibold uppercase tracking-wide no-underline hover:underline"
                        style={{ color: colors.accent }}
                      >
                        Signals
                      </Link>
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove ${s}`}
                      onClick={() => void removeSymbol(s)}
                      style={{
                        background: "transparent",
                        border: "none",
                        color: colors.textMuted,
                        cursor: "pointer",
                        fontSize: 18,
                        lineHeight: 1,
                        padding: 2,
                        borderRadius: borderRadius.sm
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </article>
      ) : (
        <p style={{ color: colors.textMuted }}>No watchlists yet. Create one with the button above.</p>
      )}

      <div
        style={{
          marginTop: spacing[2],
          padding: spacing[4],
          background: "rgba(0,180,255,0.04)",
          border: "1px solid rgba(0,180,255,0.1)",
          borderRadius: 8,
          color: colors.textMuted,
          fontSize: typography.scale.sm,
          lineHeight: 1.5
        }}
      >
        Your default watchlist powers the scanner. Add symbols here to see their signals in the morning brief and Gap Intelligence.
      </div>

    </div>
  );
}
