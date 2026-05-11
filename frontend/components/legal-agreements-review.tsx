"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CuteLoader } from "@/components/cute-loader";
import type { UserMePayload } from "@/lib/api/contracts";
import {
  AGREEMENTS_BUNDLE_VERSION,
  AGREEMENTS_DOCUMENT_LINKS,
  agreementsBundleLabel,
} from "@/lib/legal-agreements";
import { usePublishAssistantContext } from "@/lib/assistant/context";
import { borderRadius, spacing, surfaceGlowClassName, typography } from "@/lib/design-system";
import { useTheme } from "@/lib/theme-provider";

function formatAcceptedAt(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

export function LegalAgreementsReview() {
  const { colors } = useTheme();
  const [profile, setProfile] = useState<UserMePayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  usePublishAssistantContext({ page: "dashboard/legal" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/stocvest/users/me", { cache: "no-store" });
        const data = (await res.json().catch(() => ({}))) as UserMePayload & { message?: string };
        if (cancelled) return;
        if (!res.ok) {
          setLoadError(data.message || "Could not load your profile.");
          return;
        }
        setProfile(data);
      } catch {
        if (!cancelled) setLoadError("Could not load your profile.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loadError) {
    return (
      <p className="m-0 text-sm" style={{ color: colors.bearish }}>
        {loadError}
      </p>
    );
  }

  if (!profile) {
    return <CuteLoader label="Loading agreement record…" />;
  }

  const ack = profile.legal_acknowledged;
  const ver = profile.legal_acknowledged_version?.trim() || null;
  const at = profile.legal_acknowledged_at;

  return (
    <div style={{ display: "grid", gap: spacing[4] }}>
      <article
        className={surfaceGlowClassName}
        style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: borderRadius.xl, padding: spacing[4] }}
      >
        <h2 style={{ marginTop: 0, marginBottom: spacing[2], fontSize: typography.scale.lg }}>What you agreed to</h2>
        <p style={{ margin: 0, color: colors.textMuted, fontSize: typography.scale.sm, lineHeight: 1.6 }}>
          STOCVEST stores the <strong style={{ color: colors.text }}>agreement bundle version</strong> and{" "}
          <strong style={{ color: colors.text }}>time of acceptance</strong> on your account (same fields used at signup and dashboard
          acknowledgment). The links below always open the <strong style={{ color: colors.text }}>current</strong> legal text on the site. If
          we publish a new version, we may ask you to acknowledge again; your history here shows the version that was on file when you last
          confirmed.
        </p>
      </article>

      <article
        className={surfaceGlowClassName}
        style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: borderRadius.xl, padding: spacing[4] }}
      >
        <h3 style={{ marginTop: 0 }}>Record on your account</h3>
        {!ack ? (
          <div style={{ display: "grid", gap: spacing[2] }}>
            <p style={{ margin: 0, color: colors.textMuted, fontSize: typography.scale.sm, lineHeight: 1.55 }}>
              No legal acknowledgment is stored yet. Complete the full-screen checklist when prompted on the dashboard, or finish signup and
              sign in so your registration acceptance can be saved.
            </p>
            <Link href="/dashboard" className="text-sm font-semibold" style={{ color: colors.accent }}>
              Back to dashboard
            </Link>
          </div>
        ) : (
          <dl
            style={{
              margin: 0,
              display: "grid",
              gap: spacing[2],
              fontSize: typography.scale.sm,
            }}
          >
            <div>
              <dt style={{ color: colors.textMuted, marginBottom: 4 }}>Bundle</dt>
              <dd style={{ margin: 0, color: colors.text, fontFamily: "ui-monospace, monospace" }}>{agreementsBundleLabel()}</dd>
            </div>
            <div>
              <dt style={{ color: colors.textMuted, marginBottom: 4 }}>Version last accepted</dt>
              <dd style={{ margin: 0, color: colors.text, fontFamily: "ui-monospace, monospace" }}>
                {ver || "—"}
                {ver && ver !== AGREEMENTS_BUNDLE_VERSION ? (
                  <span style={{ color: colors.textMuted, fontFamily: "inherit" }}>
                    {" "}
                    (current site bundle is {AGREEMENTS_BUNDLE_VERSION})
                  </span>
                ) : null}
              </dd>
            </div>
            <div>
              <dt style={{ color: colors.textMuted, marginBottom: 4 }}>Accepted at (your browser locale)</dt>
              <dd style={{ margin: 0, color: colors.text }}>{formatAcceptedAt(at)}</dd>
            </div>
          </dl>
        )}
      </article>

      <article
        className={surfaceGlowClassName}
        style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: borderRadius.xl, padding: spacing[4] }}
      >
        <h3 style={{ marginTop: 0 }}>Documents in that bundle</h3>
        <p style={{ margin: `0 0 ${spacing[2]}`, color: colors.textMuted, fontSize: typography.scale.sm, lineHeight: 1.55 }}>
          Each of these was part of the registration / acknowledgment flow for the version above.
        </p>
        <ul style={{ margin: 0, paddingLeft: "1.1rem", color: colors.text, lineHeight: 1.7 }}>
          {AGREEMENTS_DOCUMENT_LINKS.map((doc) => (
            <li key={doc.href}>
              <Link href={doc.href} style={{ color: colors.accent, fontWeight: 600 }} target="_blank" rel="noopener noreferrer">
                {doc.label}
              </Link>
            </li>
          ))}
        </ul>
      </article>
    </div>
  );
}
