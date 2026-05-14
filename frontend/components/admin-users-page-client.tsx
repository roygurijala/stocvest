"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  KeyRound,
  Search,
  ShieldCheck,
  ShieldOff,
  Users
} from "lucide-react";

import {
  addUserToGroup,
  fetchUserDetail,
  removeUserFromGroup,
  resetUserPassword,
  searchUsersDiagnostic,
  userMutationErrorLabel,
  type AdminApiReadError,
  type AdminUserDetail,
  type AdminUserMutationOutcome,
  type AdminUserSummaryRow
} from "@/lib/api/admin-users";
import {
  fetchUserAuditEvents,
  statusCodeTone,
  type AuditEventRow
} from "@/lib/api/admin-audit";
import { AdminApiErrorCard } from "@/components/admin/admin-api-error-card";
import { AdminListPager } from "@/components/admin/admin-list-pager";
import {
  borderRadius,
  cardSurfaceStyle,
  spacing,
  typography
} from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

const ADMIN_GROUP = "signal-analytics-admin";
/** Page size for the Admin Users list. Matches the backend default. */
const USERS_PAGE_SIZE = 25;

type FlashKind = "success" | "error" | "info";
interface Flash {
  kind: FlashKind;
  title: string;
  body: string;
}

/**
 * Admin users page — `/dashboard/admin/users`.
 *
 * Three-column workflow:
 *
 *   1. Search box (top) — Cognito email-prefix search via the typed
 *      client; results render in a list below the input.
 *   2. Results list (left) — click a row to load that user's detail.
 *   3. Detail panel (right) — Cognito + UserProfile + group membership
 *      with four mutation buttons: grant/revoke admin, reset password,
 *      and (link to) the per-user audit feed.
 *
 * Beta-access toggle still lives on the legacy `PATCH /v1/admin/users/{id}/beta-access`
 * endpoint that shipped pre-hub. We surface it here as a button so the
 * admin doesn't have to remember a curl invocation; the BFF path is
 * already wired so we just call it directly.
 */
export function AdminUsersPageClient() {
  const { colors } = useTheme();
  const [query, setQuery] = useState("");
  /**
   * Pagination state. `queried` is the query the current page belongs
   * to (separate from the live `query` input so typing in the box
   * doesn't blow away the rendered list before the user hits Search).
   * `tokenStack` is the sequence of Cognito PaginationTokens consumed
   * so far — its length is the 0-indexed page number we're on. Prev
   * pops one off; Next pushes `nextToken`. `errored` distinguishes a
   * genuine upstream failure ("Check admin permissions") from a
   * legitimately empty pool ("no users yet").
   */
  const [searchState, setSearchState] = useState<{
    loading: boolean;
    items: AdminUserSummaryRow[];
    queried: string;
    nextToken: string | null;
    tokenStack: string[];
    /**
     * Typed diagnostic envelope for the most recent failed fetch.
     * `null` means "no error". The previous `errored: boolean` flag
     * collapsed every failure mode to one opaque "Failed to load
     * users" line; carrying the full envelope lets the empty state
     * render the actual HTTP status + an actionable hint
     * (e.g. 404 → "route not deployed; run terraform apply").
     */
    error: AdminApiReadError | null;
  }>({
    loading: true,
    items: [],
    queried: "",
    nextToken: null,
    tokenStack: [],
    error: null
  });
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [detailState, setDetailState] = useState<{
    loading: boolean;
    detail: AdminUserDetail | null;
    audit: AuditEventRow[];
    error: string | null;
  }>({ loading: false, detail: null, audit: [], error: null });
  const [actionPending, setActionPending] = useState<string | null>(null);
  const [flash, setFlash] = useState<Flash | null>(null);

  /**
   * Fetch one page of results.
   *
   * `pageToken === null` ⇒ first page (no token forwarded).
   * `stackForPage` is the new tokenStack value to set on success —
   * the caller knows whether we navigated forward (push) or back
   * (pop) so it owns the stack mutation, not this helper.
   */
  const runSearch = useCallback(
    async (q: string, pageToken: string | null, stackForPage: string[]) => {
      setSearchState((s) => ({ ...s, loading: true, error: null }));
      const outcome = await searchUsersDiagnostic(q, {
        limit: USERS_PAGE_SIZE,
        pageToken
      });
      if (outcome.kind === "error") {
        setSearchState({
          loading: false,
          items: [],
          queried: q,
          nextToken: null,
          tokenStack: stackForPage,
          error: outcome.error
        });
        return;
      }
      setSearchState({
        loading: false,
        items: outcome.data.items,
        queried: q,
        nextToken: outcome.data.next_token,
        tokenStack: stackForPage,
        error: null
      });
    },
    []
  );

  // First load — render the full user pool on mount, paginated.
  // Effect runs once; subsequent fetches are driven by the search
  // form, Prev/Next buttons, or post-mutation refreshes.
  useEffect(() => {
    void runSearch("", null, []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadDetail = useCallback(async (userId: string) => {
    setDetailState({ loading: true, detail: null, audit: [], error: null });
    const detail = await fetchUserDetail(userId);
    if (!detail) {
      setDetailState({
        loading: false,
        detail: null,
        audit: [],
        error: "User detail unavailable — verify Cognito sub and admin permissions."
      });
      return;
    }
    const audit = (await fetchUserAuditEvents(userId, { limit: 20 })) || [];
    setDetailState({ loading: false, detail, audit, error: null });
  }, []);

  useEffect(() => {
    if (selectedUserId) {
      void loadDetail(selectedUserId);
    } else {
      setDetailState({ loading: false, detail: null, audit: [], error: null });
    }
  }, [selectedUserId, loadDetail]);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // Empty search field is now a valid action — it resets the list
    // to "show everyone again". Submitting always starts at page 1.
    setSelectedUserId(null);
    void runSearch(query.trim(), null, []);
  };

  const onNextPage = useCallback(() => {
    if (!searchState.nextToken || searchState.loading) return;
    const nextStack = [...searchState.tokenStack, searchState.nextToken];
    void runSearch(searchState.queried, searchState.nextToken, nextStack);
  }, [
    runSearch,
    searchState.loading,
    searchState.nextToken,
    searchState.queried,
    searchState.tokenStack
  ]);

  const onPrevPage = useCallback(() => {
    if (searchState.tokenStack.length === 0 || searchState.loading) return;
    // Pop the last token to land on the page before it. The new top
    // of stack (after pop) is the token used to fetch the now-current
    // page. ``null`` means "first page, no token at all".
    const popped = searchState.tokenStack.slice(0, -1);
    const tokenForCurrentPage = popped.length === 0 ? null : popped[popped.length - 1];
    void runSearch(searchState.queried, tokenForCurrentPage, popped);
  }, [runSearch, searchState.loading, searchState.queried, searchState.tokenStack]);

  const onClearSearch = useCallback(() => {
    setQuery("");
    setSelectedUserId(null);
    void runSearch("", null, []);
  }, [runSearch]);

  const handleResetPassword = useCallback(async () => {
    if (!detailState.detail) return;
    setActionPending("reset-password");
    const outcome = await resetUserPassword(detailState.detail.user_id);
    setActionPending(null);
    handleOutcomeFlash(setFlash, outcome, {
      okTitle: "Reset email sent",
      okBody: `Cognito will email ${detailState.detail.email} a fresh password reset link.`,
      errPrefix: "Password reset failed"
    });
  }, [detailState.detail]);

  const handleGroupToggle = useCallback(async () => {
    if (!detailState.detail) return;
    const want = !detailState.detail.is_admin;
    setActionPending("toggle-admin");
    const outcome = want
      ? await addUserToGroup(detailState.detail.user_id, ADMIN_GROUP)
      : await removeUserFromGroup(detailState.detail.user_id, ADMIN_GROUP);
    setActionPending(null);
    handleOutcomeFlash(setFlash, outcome, {
      okTitle: want ? "Admin granted" : "Admin revoked",
      okBody: `${detailState.detail.email} is now ${want ? "an admin" : "no longer an admin"}.`,
      errPrefix: "Group mutation failed"
    });
    if (outcome.kind === "ok") {
      await loadDetail(detailState.detail.user_id);
    }
  }, [detailState.detail, loadDetail]);

  const handleBetaToggle = useCallback(
    async (enabled: boolean) => {
      if (!detailState.detail) return;
      setActionPending("beta-toggle");
      try {
        const response = await fetch(
          `/api/stocvest/admin/users/${encodeURIComponent(detailState.detail.user_id)}/beta-access`,
          {
            method: "PATCH",
            credentials: "include",
            cache: "no-store",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ enabled, indefinite: enabled })
          }
        );
        if (response.ok) {
          setFlash({
            kind: "success",
            title: enabled ? "Beta access granted" : "Beta access revoked",
            body: `${detailState.detail.email} ${
              enabled ? "now has full beta access (indefinite)." : "no longer has beta access."
            }`
          });
          await loadDetail(detailState.detail.user_id);
        } else {
          setFlash({
            kind: "error",
            title: "Beta access update failed",
            body: `Status ${response.status} — verify the BFF route is wired.`
          });
        }
      } catch (exc) {
        setFlash({
          kind: "error",
          title: "Beta access update failed",
          body: exc instanceof Error ? exc.message : "Network error."
        });
      }
      setActionPending(null);
    },
    [detailState.detail, loadDetail]
  );

  return (
    <div style={{ display: "grid", gap: spacing[5] }}>
      <header style={{ display: "grid", gap: spacing[2] }}>
        <h1
          style={{
            margin: 0,
            color: colors.text,
            fontSize: typography.scale["2xl"],
            fontWeight: 700,
            letterSpacing: "-0.01em",
            display: "flex",
            alignItems: "center",
            gap: spacing[2]
          }}
        >
          <Users size={22} aria-hidden /> Users
        </h1>
        <p
          style={{
            margin: 0,
            color: colors.textMuted,
            fontSize: typography.scale.sm,
            maxWidth: "70ch",
            lineHeight: 1.55
          }}
        >
          Lists every user in the Cognito pool — {USERS_PAGE_SIZE} at a
          time, paginated. Use the email prefix box to filter, or
          leave it blank to keep browsing the full pool. Click a row
          to inspect profile + Cognito state and manage beta access
          or admin group membership. The first admin must be granted
          via the{" "}
          <code style={{ color: colors.accent }}>scripts/grant_admin.py</code>{" "}
          bootstrap script; subsequent grants happen entirely here.
        </p>
      </header>

      <FlashBanner flash={flash} onDismiss={() => setFlash(null)} />

      <form
        onSubmit={onSubmit}
        style={{
          display: "flex",
          gap: spacing[2],
          alignItems: "center"
        }}
      >
        <Search size={16} aria-hidden style={{ color: colors.textMuted }} />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by email prefix (leave blank for all users)…"
          aria-label="Filter users by email prefix"
          data-testid="admin-users-search-input"
          style={{
            flex: 1,
            padding: `${spacing[2]} ${spacing[3]}`,
            borderRadius: borderRadius.md,
            border: `1px solid ${colors.border}`,
            background: colors.surface,
            color: colors.text,
            fontSize: typography.scale.sm
          }}
        />
        <button
          type="submit"
          data-testid="admin-users-search-submit"
          style={{
            padding: `${spacing[2]} ${spacing[4]}`,
            borderRadius: borderRadius.md,
            border: `1px solid ${colors.accent}`,
            background: "rgba(59,130,246,0.12)",
            color: colors.accent,
            fontSize: typography.scale.sm,
            fontWeight: 600,
            cursor: "pointer"
          }}
        >
          Filter
        </button>
        {searchState.queried !== "" ? (
          <button
            type="button"
            onClick={onClearSearch}
            data-testid="admin-users-search-clear"
            style={{
              padding: `${spacing[2]} ${spacing[3]}`,
              borderRadius: borderRadius.md,
              border: `1px solid ${colors.border}`,
              background: "transparent",
              color: colors.textMuted,
              fontSize: typography.scale.sm,
              cursor: "pointer"
            }}
          >
            Show all
          </button>
        ) : null}
      </form>

      <div
        className="admin-users-layout"
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr)",
          gap: spacing[5],
          alignItems: "start"
        }}
      >
        <section data-testid="admin-users-results" style={{ display: "grid", gap: spacing[3] }}>
          {searchState.loading && searchState.items.length === 0 ? (
            <EmptyCard message="Loading users…" />
          ) : searchState.error ? (
            <AdminApiErrorCard
              error={searchState.error}
              onRetry={() =>
                void runSearch(searchState.queried, null, [])
              }
              testId="admin-users-error-card"
            />
          ) : searchState.items.length === 0 ? (
            <EmptyCard
              message={
                searchState.queried
                  ? `No users match "${searchState.queried}".`
                  : "No users found in the pool yet."
              }
            />
          ) : (
            <ul
              data-testid="admin-users-result-list"
              style={{
                listStyle: "none",
                margin: 0,
                padding: 0,
                display: "grid",
                gap: spacing[2]
              }}
            >
              {searchState.items.map((row) => (
                <ResultRow
                  key={row.user_id}
                  row={row}
                  selected={row.user_id === selectedUserId}
                  onSelect={() => setSelectedUserId(row.user_id)}
                />
              ))}
            </ul>
          )}
          {/* Pager renders whenever there's any pagination state to
              navigate — either we're past page 1, or the current page
              has a next-token. If neither is true we skip it entirely
              so a 0–25-user pool doesn't show a redundant
              "Page 1 · 0 of 25" footer. */}
          {searchState.tokenStack.length > 0 || searchState.nextToken ? (
            <AdminListPager
              pageIndex={searchState.tokenStack.length}
              hasPrev={searchState.tokenStack.length > 0}
              hasNext={searchState.nextToken !== null}
              loading={searchState.loading}
              visibleCount={searchState.items.length}
              pageSize={USERS_PAGE_SIZE}
              onPrev={onPrevPage}
              onNext={onNextPage}
              testId="admin-users-pager"
            />
          ) : null}
        </section>

        {selectedUserId ? (
          <section data-testid="admin-users-detail">
            <DetailPanel
              loading={detailState.loading}
              detail={detailState.detail}
              audit={detailState.audit}
              error={detailState.error}
              actionPending={actionPending}
              onResetPassword={() => void handleResetPassword()}
              onToggleAdmin={() => void handleGroupToggle()}
              onBetaToggle={handleBetaToggle}
              onClose={() => setSelectedUserId(null)}
            />
          </section>
        ) : null}
      </div>

      <style jsx>{`
        @media (min-width: 1100px) {
          :global(.admin-users-layout) {
            grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr) !important;
          }
        }
      `}</style>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function handleOutcomeFlash<T>(
  setFlash: (f: Flash | null) => void,
  outcome: AdminUserMutationOutcome<T>,
  copy: { okTitle: string; okBody: string; errPrefix: string }
): void {
  if (outcome.kind === "ok") {
    setFlash({ kind: "success", title: copy.okTitle, body: copy.okBody });
    return;
  }
  setFlash({
    kind: "error",
    title: copy.errPrefix,
    body: `${userMutationErrorLabel(outcome.code)} (status ${outcome.status})`
  });
}

// ── Sub-components ─────────────────────────────────────────────────────────

function FlashBanner({
  flash,
  onDismiss
}: {
  flash: Flash | null;
  onDismiss: () => void;
}) {
  const { colors } = useTheme();
  if (!flash) return null;
  const tone =
    flash.kind === "success" ? "bullish" : flash.kind === "error" ? "bearish" : "caution";
  const Icon = flash.kind === "success" ? CheckCircle2 : AlertCircle;
  return (
    <div
      data-testid="admin-users-flash"
      data-flash-kind={flash.kind}
      style={{
        ...cardSurfaceStyle(colors, tone),
        padding: `${spacing[3]} ${spacing[4]}`,
        borderRadius: borderRadius.lg,
        display: "flex",
        alignItems: "flex-start",
        gap: spacing[3]
      }}
    >
      <Icon size={18} />
      <div style={{ display: "grid", gap: spacing[1], flex: 1 }}>
        <span style={{ color: colors.text, fontWeight: 600, fontSize: typography.scale.sm }}>
          {flash.title}
        </span>
        <span style={{ color: colors.textMuted, fontSize: typography.scale.sm }}>
          {flash.body}
        </span>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        style={{
          background: "transparent",
          border: "none",
          color: colors.textMuted,
          cursor: "pointer",
          fontSize: typography.scale.xs
        }}
      >
        Dismiss
      </button>
    </div>
  );
}

function EmptyCard({
  message,
  tone = "neutral"
}: {
  message: string;
  tone?: "neutral" | "bearish";
}) {
  const { colors } = useTheme();
  return (
    <div
      data-testid="admin-users-empty"
      data-tone={tone}
      style={{
        ...cardSurfaceStyle(colors, tone),
        padding: spacing[4],
        borderRadius: borderRadius.lg,
        color: tone === "bearish" ? colors.text : colors.textMuted,
        fontSize: typography.scale.sm
      }}
    >
      {message}
    </div>
  );
}

function subscriptionPlanLabel(plan: string): string {
  const p = (plan || "free").trim().toLowerCase();
  if (p === "swing_day_pro") return "Swing + Day Pro";
  if (p === "swing_pro") return "Swing Pro";
  return "Free";
}

function formatLastActiveDisplay(iso: string | null | undefined): string {
  if (!iso || !String(iso).trim()) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return "—";
  }
}

function ResultRow({
  row,
  selected,
  onSelect
}: {
  row: AdminUserSummaryRow;
  selected: boolean;
  onSelect: () => void;
}) {
  const { colors } = useTheme();
  return (
    <li
      data-testid="admin-users-result-row"
      data-user-id={row.user_id}
      data-selected={selected}
    >
      <button
        type="button"
        onClick={onSelect}
        style={{
          width: "100%",
          textAlign: "left",
          padding: spacing[3],
          borderRadius: borderRadius.md,
          border: `1px solid ${selected ? colors.accent : colors.border}`,
          background: selected ? "rgba(59,130,246,0.08)" : colors.surface,
          cursor: "pointer",
          display: "grid",
          gap: spacing[1]
        }}
      >
        <span style={{ color: colors.text, fontWeight: 600, fontSize: typography.scale.sm }}>
          {row.email || row.username || row.user_id}
        </span>
        <span style={{ color: colors.textMuted, fontSize: typography.scale.xs }}>
          {row.status}
          {!row.enabled ? " · DISABLED" : ""}
          {!row.email_verified ? " · email unverified" : ""}
        </span>
        <span
          style={{
            color: colors.textMuted,
            fontSize: typography.scale.xs,
            fontVariantNumeric: "tabular-nums",
            opacity: 0.8
          }}
        >
          sub: {row.user_id}
        </span>
        <span style={{ color: colors.textMuted, fontSize: typography.scale.xs }}>
          Plan: {subscriptionPlanLabel(row.subscription_plan)}
          {" · "}
          Last active: {formatLastActiveDisplay(row.last_active_at)}
        </span>
      </button>
    </li>
  );
}

function DetailPanel({
  loading,
  detail,
  audit,
  error,
  actionPending,
  onResetPassword,
  onToggleAdmin,
  onBetaToggle,
  onClose
}: {
  loading: boolean;
  detail: AdminUserDetail | null;
  audit: AuditEventRow[];
  error: string | null;
  actionPending: string | null;
  onResetPassword: () => void;
  onToggleAdmin: () => void;
  onBetaToggle: (enabled: boolean) => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  if (loading) return <EmptyCard message="Loading user…" />;
  if (error) {
    return (
      <div
        data-testid="admin-users-detail-error"
        style={{
          ...cardSurfaceStyle(colors, "bearish"),
          padding: spacing[4],
          borderRadius: borderRadius.lg,
          color: colors.text,
          fontSize: typography.scale.sm
        }}
      >
        {error}
      </div>
    );
  }
  if (!detail) return null;
  return (
    <div style={{ display: "grid", gap: spacing[4] }}>
      <div
        style={{
          ...cardSurfaceStyle(colors, "neutral"),
          padding: spacing[4],
          borderRadius: borderRadius.lg,
          display: "grid",
          gap: spacing[3]
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: spacing[2],
            alignItems: "flex-start"
          }}
        >
          <div style={{ display: "grid", gap: spacing[1] }}>
            <span
              data-testid="detail-email"
              style={{
                color: colors.text,
                fontWeight: 700,
                fontSize: typography.scale.lg
              }}
            >
              {detail.email || detail.username}
            </span>
            <span style={{ color: colors.textMuted, fontSize: typography.scale.xs }}>
              sub: {detail.user_id}
            </span>
            {detail.is_admin ? (
              <span
                data-testid="detail-admin-badge"
                style={{
                  color: colors.accent,
                  fontSize: typography.scale.xs,
                  background: "rgba(59,130,246,0.12)",
                  padding: `${spacing[1]} ${spacing[2]}`,
                  borderRadius: borderRadius.sm,
                  fontWeight: 600,
                  width: "fit-content"
                }}
              >
                ADMIN
              </span>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close detail panel"
            style={{
              background: "transparent",
              border: "none",
              color: colors.textMuted,
              cursor: "pointer",
              fontSize: typography.scale.sm
            }}
          >
            Close ×
          </button>
        </div>

        <dl
          style={{
            display: "grid",
            gridTemplateColumns: "auto 1fr",
            gap: `${spacing[1]} ${spacing[4]}`,
            margin: 0,
            fontSize: typography.scale.sm,
            color: colors.text
          }}
        >
          <DT>Status</DT>
          <dd style={{ margin: 0 }}>
            {detail.status} {!detail.enabled ? "(disabled)" : ""}
          </dd>
          <DT>Email verified</DT>
          <dd style={{ margin: 0 }}>{detail.email_verified ? "yes" : "no"}</dd>
          <DT>Plan</DT>
          <dd style={{ margin: 0 }}>{subscriptionPlanLabel(detail.profile.subscription_plan)}</dd>
          <DT>Last active</DT>
          <dd style={{ margin: 0 }}>{formatLastActiveDisplay(detail.profile.last_active_at)}</dd>
          <DT>Beta access</DT>
          <dd style={{ margin: 0 }}>
            {detail.profile.beta_full_access
              ? `enabled${detail.profile.beta_access_until ? ` until ${detail.profile.beta_access_until}` : " (indefinite)"}`
              : "disabled"}
          </dd>
          <DT>Trading mode</DT>
          <dd style={{ margin: 0 }}>{detail.profile.trading_mode}</dd>
          <DT>Created</DT>
          <dd style={{ margin: 0 }}>{detail.created_at || "—"}</dd>
        </dl>

        <div
          style={{
            display: "flex",
            gap: spacing[2],
            flexWrap: "wrap"
          }}
        >
          <ActionButton
            label={detail.is_admin ? "Revoke admin" : "Grant admin"}
            icon={detail.is_admin ? <ShieldOff size={14} /> : <ShieldCheck size={14} />}
            disabled={actionPending !== null}
            pending={actionPending === "toggle-admin"}
            tone={detail.is_admin ? "bearish" : "accent"}
            onClick={onToggleAdmin}
            testId="action-toggle-admin"
          />
          <ActionButton
            label="Reset password"
            icon={<KeyRound size={14} />}
            disabled={actionPending !== null}
            pending={actionPending === "reset-password"}
            onClick={onResetPassword}
            testId="action-reset-password"
          />
          <ActionButton
            label={detail.profile.beta_full_access ? "Revoke beta" : "Grant beta"}
            icon={<CheckCircle2 size={14} />}
            disabled={actionPending !== null}
            pending={actionPending === "beta-toggle"}
            onClick={() => onBetaToggle(!detail.profile.beta_full_access)}
            testId="action-beta-toggle"
          />
        </div>
      </div>

      <div
        style={{
          ...cardSurfaceStyle(colors, "neutral"),
          padding: spacing[4],
          borderRadius: borderRadius.lg,
          display: "grid",
          gap: spacing[3]
        }}
      >
        <h3 style={{ margin: 0, color: colors.text, fontSize: typography.scale.lg }}>
          Recent audit events
        </h3>
        {audit.length === 0 ? (
          <p style={{ margin: 0, color: colors.textMuted, fontSize: typography.scale.sm }}>
            No audit events captured for this user.
          </p>
        ) : (
          <ul
            data-testid="detail-audit-feed"
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "grid",
              gap: spacing[2]
            }}
          >
            {audit.map((evt) => {
              const tone = statusCodeTone(evt.status_code);
              return (
                <li
                  key={evt.event_id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "auto 1fr auto",
                    gap: spacing[2],
                    alignItems: "center",
                    padding: `${spacing[2]} ${spacing[3]}`,
                    border: `1px solid ${colors.border}`,
                    borderRadius: borderRadius.md,
                    fontSize: typography.scale.xs
                  }}
                >
                  <span
                    style={{
                      color:
                        tone === "success"
                          ? colors.bullish
                          : tone === "warning"
                            ? colors.caution
                            : tone === "error"
                              ? colors.bearish
                              : colors.textMuted,
                      fontWeight: 600
                    }}
                  >
                    {evt.status_code || "—"}
                  </span>
                  <span style={{ color: colors.text, fontSize: typography.scale.xs }}>
                    {evt.route}
                  </span>
                  <span
                    style={{
                      color: colors.textMuted,
                      fontVariantNumeric: "tabular-nums"
                    }}
                  >
                    {evt.occurred_at}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function DT({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <dt
      style={{
        color: colors.textMuted,
        fontSize: typography.scale.xs,
        textTransform: "uppercase",
        letterSpacing: "0.05em"
      }}
    >
      {children}
    </dt>
  );
}

function ActionButton({
  label,
  icon,
  pending,
  disabled,
  tone = "accent",
  onClick,
  testId
}: {
  label: string;
  icon: React.ReactNode;
  pending: boolean;
  disabled: boolean;
  tone?: "accent" | "bearish";
  onClick: () => void;
  testId?: string;
}) {
  const { colors } = useTheme();
  const isBearish = tone === "bearish";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: spacing[2],
        padding: `${spacing[2]} ${spacing[3]}`,
        borderRadius: borderRadius.md,
        border: `1px solid ${isBearish ? colors.bearish : colors.accent}`,
        background: isBearish ? "rgba(239,68,68,0.12)" : "rgba(59,130,246,0.12)",
        color: isBearish ? colors.bearish : colors.accent,
        fontSize: typography.scale.sm,
        fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled && !pending ? 0.55 : 1
      }}
    >
      {icon}
      {pending ? "Working…" : label}
    </button>
  );
}
