"use client";

import Link from "next/link";
import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type Dispatch,
  type HTMLAttributes,
  type SetStateAction
} from "react";
import { createPortal } from "react-dom";
import { borderRadius, colorTokens, spacing, typography } from "@/lib/design-system";
import { invalidateWatchlistMembershipCache, useDefaultWatchlistMembership } from "@/lib/watchlist-membership-client";
import {
  defaultDeskTracking,
  saveSymbolDeskTracking,
  type WatchlistDeskTracking
} from "@/lib/watchlist-symbol-tracking";
import { formatWatchlistMaturationDisplayLine } from "@/lib/alignment-display-tier";
import {
  normalizeWatchlistMaturationBySymbol,
  type WatchlistMaturationRow
} from "@/lib/watchlist-page-utils";
import { tracksDesk } from "@/lib/watchlist-tracking-presentation";
import { primeWatchlistSymbolMaturation } from "@/lib/watchlist-maturation-prime";
import { useTheme } from "@/lib/theme-provider";

type Props = {
  symbol: string;
  dualDeskTracking?: boolean;
  className?: string;
};

type ThemeColors = (typeof colorTokens)["dark"];

type DeskMaturationPreview = {
  swing?: WatchlistMaturationRow;
  day?: WatchlistMaturationRow;
  status: "idle" | "loading" | "ready" | "error";
};

function maturationLineColor(state: string | undefined, colors: ThemeColors): string {
  switch ((state || "").toLowerCase()) {
    case "actionable":
      return colors.bullish;
    case "developing":
    case "re_evaluating":
      return "#f59e0b";
    default:
      return colors.textMuted;
  }
}

export function AddToWatchlistButton({ symbol, dualDeskTracking = true, className }: Props) {
  const { colors, theme } = useTheme();
  const { symU, isOnList, watchlistId, trackingForSymbol, loading, refresh } = useDefaultWatchlistMembership(
    symbol,
    dualDeskTracking
  );
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [addPhase, setAddPhase] = useState<"idle" | "busy" | "err">("idle");
  const [panelPhase, setPanelPhase] = useState<"idle" | "busy" | "err">("idle");
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [draftTracking, setDraftTracking] = useState<WatchlistDeskTracking>(() =>
    defaultDeskTracking(dualDeskTracking)
  );
  const [maturationPreview, setMaturationPreview] = useState<DeskMaturationPreview>({ status: "idle" });
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const popoverId = useId();

  const syncDraftTracking = useCallback(() => {
    if (trackingForSymbol) {
      setDraftTracking(trackingForSymbol);
    } else {
      setDraftTracking(defaultDeskTracking(dualDeskTracking));
    }
  }, [trackingForSymbol, dualDeskTracking]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!popoverOpen) return;
    syncDraftTracking();
    const place = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setPopoverPos({
        top: r.bottom + 6,
        left: Math.min(r.left, window.innerWidth - 300),
        width: Math.min(300, Math.max(260, r.width))
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [popoverOpen, syncDraftTracking]);

  useEffect(() => {
    if (!popoverOpen || !symU) return;
    let cancelled = false;
    setMaturationPreview({ status: "loading" });
    void (async () => {
      try {
        const fetches = dualDeskTracking
          ? [
              fetch("/api/stocvest/watchlists/maturation-summary?mode=swing", { cache: "no-store" }),
              fetch("/api/stocvest/watchlists/maturation-summary?mode=day", { cache: "no-store" })
            ]
          : [fetch("/api/stocvest/watchlists/maturation-summary?mode=swing", { cache: "no-store" })];
        const results = await Promise.all(fetches);
        if (cancelled) return;
        const swingJson = results[0] ? await results[0].json().catch(() => ({})) : {};
        const dayJson = results[1] ? await results[1].json().catch(() => ({})) : {};
        const swingMap = normalizeWatchlistMaturationBySymbol(swingJson);
        const dayMap = dualDeskTracking ? normalizeWatchlistMaturationBySymbol(dayJson) : {};
        setMaturationPreview({
          status: "ready",
          swing: swingMap[symU],
          day: dayMap[symU]
        });
      } catch {
        if (!cancelled) setMaturationPreview({ status: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [popoverOpen, symU, dualDeskTracking]);

  useEffect(() => {
    if (!popoverOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target;
      if (!(t instanceof Node)) return;
      if (anchorRef.current?.contains(t)) return;
      if (popoverRef.current?.contains(t)) return;
      setPopoverOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPopoverOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [popoverOpen]);

  const onAdd = useCallback(async () => {
    if (!symU) return;
    setAddPhase("busy");
    setStatusMsg(null);
    const defaults = defaultDeskTracking(dualDeskTracking);
    try {
      const res = await fetch("/api/stocvest/watchlists/default/symbols", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          symbol: symU,
          track_swing: defaults.swing,
          track_day: defaults.day
        })
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      if (res.status === 400 && data.error === "symbol_limit") {
        setStatusMsg("Watchlist full (50 symbols)");
        setAddPhase("err");
        return;
      }
      if (!res.ok) {
        setStatusMsg(data.message || "Could not add symbol");
        setAddPhase("err");
        return;
      }
      invalidateWatchlistMembershipCache();
      await refresh();
      void primeWatchlistSymbolMaturation(symU, dualDeskTracking);
      setAddPhase("idle");
      setToast(`${symU} added to your watchlist`);
    } catch {
      setStatusMsg("Network error");
      setAddPhase("err");
    }
  }, [symU, dualDeskTracking, refresh]);

  const onSaveTracking = useCallback(async () => {
    if (!symU || !watchlistId) return;
    const next: WatchlistDeskTracking = dualDeskTracking
      ? { swing: draftTracking.swing, day: draftTracking.day }
      : { swing: draftTracking.swing, day: false };
    if (!next.swing && !next.day) {
      setStatusMsg("Select at least one desk to track.");
      setPanelPhase("err");
      return;
    }
    setPanelPhase("busy");
    setStatusMsg(null);
    const result = await saveSymbolDeskTracking(watchlistId, symU, next, dualDeskTracking);
    if (!result.ok) {
      setStatusMsg(result.message || "Could not save changes");
      setPanelPhase("err");
      return;
    }
    invalidateWatchlistMembershipCache();
    await refresh();
    setPanelPhase("idle");
    setPopoverOpen(false);
    setToast(`Tracking updated for ${symU}`);
  }, [symU, watchlistId, draftTracking, dualDeskTracking, refresh]);

  const onRemove = useCallback(async () => {
    if (!symU || !watchlistId) return;
    setPanelPhase("busy");
    setStatusMsg(null);
    try {
      const res = await fetch(
        `/api/stocvest/watchlists/${encodeURIComponent(watchlistId)}/symbols/${encodeURIComponent(symU)}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        setStatusMsg(data.message || "Could not remove symbol");
        setPanelPhase("err");
        return;
      }
      invalidateWatchlistMembershipCache();
      await refresh();
      setPopoverOpen(false);
      setPanelPhase("idle");
      setToast(`${symU} removed from your watchlist`);
    } catch {
      setStatusMsg("Network error");
      setPanelPhase("err");
    }
  }, [symU, watchlistId, refresh]);

  const primaryBtnStyle = {
    borderRadius: borderRadius.md,
    padding: `${spacing[1]} ${spacing[2]}`,
    cursor: loading || addPhase === "busy" ? "wait" : "pointer",
    fontSize: typography.scale.xs,
    fontWeight: 600 as const,
    opacity: loading ? 0.72 : 1
  };

  const toastEl =
    toast && typeof document !== "undefined"
      ? createPortal(
          <div
            role="status"
            style={{
              position: "fixed",
              bottom: 24,
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 60,
              padding: `${spacing[2]} ${spacing[3]}`,
              borderRadius: borderRadius.lg,
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              boxShadow: "0 8px 32px rgba(0,0,0,0.35)",
              color: colors.text,
              fontSize: typography.scale.sm,
              fontWeight: 600
            }}
          >
            {toast}
          </div>,
          document.body
        )
      : null;

  const popover =
    popoverOpen && popoverPos && typeof document !== "undefined"
      ? createPortal(
          <WatchlistInListPopover
            id={popoverId}
            popoverRef={popoverRef}
            symU={symU}
            dualDeskTracking={dualDeskTracking}
            draftTracking={draftTracking}
            setDraftTracking={setDraftTracking}
            maturationPreview={maturationPreview}
            panelPhase={panelPhase}
            statusMsg={statusMsg}
            colors={colors}
            theme={theme}
            popoverPos={popoverPos}
            onSave={() => void onSaveTracking()}
            onRemove={() => void onRemove()}
          />,
          document.body
        )
      : null;

  if (isOnList) {
    return (
      <span className={className} style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
        <button
          ref={anchorRef}
          type="button"
          aria-expanded={popoverOpen}
          aria-controls={popoverId}
          aria-haspopup="dialog"
          disabled={loading}
          onClick={() => {
            syncDraftTracking();
            setPopoverOpen((o) => !o);
            setPanelPhase("idle");
            setStatusMsg(null);
          }}
          style={{
            ...primaryBtnStyle,
            border: `1px solid ${colors.bullish}`,
            background: "rgba(34,197,94,0.14)",
            color: colors.bullish
          }}
        >
          ✓ In Watchlist
        </button>
        {popover}
        {toastEl}
      </span>
    );
  }

  return (
    <span className={className} style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
      <button
        ref={anchorRef}
        type="button"
        disabled={loading || addPhase === "busy"}
        onClick={() => void onAdd()}
        style={{
          ...primaryBtnStyle,
          border: `1px dashed ${colors.accent}`,
          background: "rgba(59,130,246,0.08)",
          color: colors.text
        }}
      >
        {addPhase === "busy" ? "Adding…" : "+ Watchlist"}
      </button>
      {statusMsg && addPhase === "err" ? (
        <span role="status" style={{ fontSize: 10, color: colors.bearish }}>
          {statusMsg}
        </span>
      ) : null}
      {toastEl}
    </span>
  );
}

const PopoverPanel = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function PopoverPanel(
  { children, ...rest },
  ref
) {
  return (
    <div ref={ref} {...rest}>
      {children}
    </div>
  );
});

function MaturationDeskLine({
  desk,
  row,
  colors
}: {
  desk: string;
  row: WatchlistMaturationRow | undefined;
  colors: ThemeColors;
}) {
  const state = row?.state;
  const display = formatWatchlistMaturationDisplayLine(row) ?? "Not evaluated yet";
  return (
    <p style={{ margin: 0, fontSize: typography.scale.xs, color: colors.textMuted, lineHeight: 1.45 }}>
      <span style={{ fontWeight: 600, color: colors.text }}>{desk}:</span>{" "}
      <span style={{ color: maturationLineColor(state, colors) }}>{display}</span>
    </p>
  );
}

function WatchlistInListPopover({
  id,
  popoverRef,
  symU,
  dualDeskTracking,
  draftTracking,
  setDraftTracking,
  maturationPreview,
  panelPhase,
  statusMsg,
  colors,
  theme,
  popoverPos,
  onSave,
  onRemove
}: {
  id: string;
  popoverRef: React.RefObject<HTMLDivElement>;
  symU: string;
  dualDeskTracking: boolean;
  draftTracking: WatchlistDeskTracking;
  setDraftTracking: Dispatch<SetStateAction<WatchlistDeskTracking>>;
  maturationPreview: DeskMaturationPreview;
  panelPhase: "idle" | "busy" | "err";
  statusMsg: string | null;
  colors: ThemeColors;
  theme: string;
  popoverPos: { top: number; left: number; width: number };
  onSave: () => void;
  onRemove: () => void;
}) {
  const busy = panelPhase === "busy";
  const accentFg = theme === "light" ? "#ffffff" : "#041018";
  const watchlistHref = `/dashboard/watchlists?focus=${encodeURIComponent(symU)}`;

  return (
    <PopoverPanel
      id={id}
      ref={popoverRef}
      role="dialog"
      aria-label={`${symU} watchlist options`}
      style={{
        position: "fixed",
        top: popoverPos.top,
        left: popoverPos.left,
        width: popoverPos.width,
        zIndex: 50,
        borderRadius: borderRadius.lg,
        border: `1px solid ${colors.border}`,
        background: colors.surface,
        boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
        padding: spacing[3]
      }}
    >
      <p style={{ margin: 0, fontSize: typography.scale.sm, fontWeight: 600, color: colors.text, lineHeight: 1.35 }}>
        {symU} is already in your watchlist
      </p>

      {maturationPreview.status === "ready" ? (
        <div style={{ marginTop: spacing[2], display: "grid", gap: 4 }}>
          {tracksDesk(draftTracking, "swing") ? (
            <MaturationDeskLine desk="Swing" row={maturationPreview.swing} colors={colors} />
          ) : null}
          {dualDeskTracking && tracksDesk(draftTracking, "day") ? (
            <MaturationDeskLine desk="Day" row={maturationPreview.day} colors={colors} />
          ) : null}
        </div>
      ) : null}

      <p style={{ margin: `${spacing[2]} 0 ${spacing[1]}`, fontSize: typography.scale.xs, color: colors.textMuted }}>
        Tracking:
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label style={{ display: "flex", alignItems: "center", gap: spacing[2], fontSize: typography.scale.sm, color: colors.text }}>
          <input
            type="checkbox"
            checked={draftTracking.swing}
            disabled={busy}
            onChange={(e) => setDraftTracking((t) => ({ ...t, swing: e.target.checked }))}
          />
          Swing
        </label>
        {dualDeskTracking ? (
          <label style={{ display: "flex", alignItems: "center", gap: spacing[2], fontSize: typography.scale.sm, color: colors.text }}>
            <input
              type="checkbox"
              checked={draftTracking.day}
              disabled={busy}
              onChange={(e) => setDraftTracking((t) => ({ ...t, day: e.target.checked }))}
            />
            Day
          </label>
        ) : null}
      </div>

      {statusMsg && panelPhase === "err" ? (
        <p role="alert" style={{ margin: `${spacing[2]} 0 0`, fontSize: typography.scale.xs, color: colors.bearish }}>
          {statusMsg}
        </p>
      ) : null}

      <button
        type="button"
        disabled={busy}
        onClick={onSave}
        style={{
          marginTop: spacing[3],
          width: "100%",
          minHeight: 36,
          borderRadius: borderRadius.md,
          border: "none",
          background: colors.accent,
          color: accentFg,
          fontSize: typography.scale.sm,
          fontWeight: 600,
          cursor: busy ? "wait" : "pointer"
        }}
      >
        {busy ? "Saving…" : "Save changes"}
      </button>

      <hr style={{ margin: `${spacing[3]} 0`, border: "none", borderTop: `1px solid ${colors.border}` }} />

      <Link
        href={watchlistHref}
        style={{
          display: "block",
          fontSize: typography.scale.sm,
          fontWeight: 600,
          color: colors.accent,
          textDecoration: "none",
          marginBottom: spacing[2]
        }}
      >
        View in Watchlist →
      </Link>

      <button
        type="button"
        disabled={busy}
        onClick={onRemove}
        style={{
          width: "100%",
          minHeight: 32,
          border: "none",
          background: "transparent",
          color: colors.textMuted,
          fontSize: typography.scale.xs,
          fontWeight: 500,
          cursor: busy ? "wait" : "pointer",
          textDecoration: "underline",
          textUnderlineOffset: 2
        }}
      >
        {busy ? "Removing…" : "Remove from watchlist"}
      </button>
    </PopoverPanel>
  );
}
