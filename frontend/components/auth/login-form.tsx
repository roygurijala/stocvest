"use client";

import { useFormState, useFormStatus } from "react-dom";
import { loginAsDevUser, loginWithToken, type LoginActionState } from "@/app/login/actions";

const INITIAL_STATE: LoginActionState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}>
      {pending ? "Signing in..." : "Sign in"}
    </button>
  );
}

function DevSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} style={{ width: "100%" }}>
      {pending ? "Signing in..." : "Continue as dev user"}
    </button>
  );
}

export function LoginForm({ showDevBypass = false }: { showDevBypass?: boolean }) {
  const [state, formAction] = useFormState(loginWithToken, INITIAL_STATE);
  const [devState, devFormAction] = useFormState(loginAsDevUser, INITIAL_STATE);
  return (
    <div style={{ display: "grid", gap: "16px", maxWidth: 460 }}>
      <form action={formAction} style={{ display: "grid", gap: "12px" }}>
        <label htmlFor="id_token">Cognito ID token</label>
        <textarea
          id="id_token"
          name="id_token"
          rows={8}
          placeholder="Paste a valid Cognito ID token"
          style={{ borderRadius: 8, padding: 10 }}
        />
        {state.error ? <p style={{ color: "#fda4af", margin: 0 }}>{state.error}</p> : null}
        <SubmitButton />
      </form>
      {showDevBypass ? (
        <div
          style={{
            borderTop: "1px solid rgba(255,255,255,0.12)",
            paddingTop: 16,
            display: "grid",
            gap: 8
          }}
        >
          <p style={{ margin: 0, fontSize: 13, opacity: 0.85 }}>
            Local development: sign in without Cognito using a mock session (not available in production).
          </p>
          <form action={devFormAction} style={{ display: "grid", gap: 8 }}>
            {devState.error ? <p style={{ color: "#fda4af", margin: 0 }}>{devState.error}</p> : null}
            <DevSubmitButton />
          </form>
        </div>
      ) : null}
    </div>
  );
}
