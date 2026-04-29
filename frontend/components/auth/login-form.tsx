"use client";

import { useFormState, useFormStatus } from "react-dom";
import { loginWithToken, type LoginActionState } from "@/app/login/actions";

const INITIAL_STATE: LoginActionState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}>
      {pending ? "Signing in..." : "Sign in"}
    </button>
  );
}

export function LoginForm() {
  const [state, formAction] = useFormState(loginWithToken, INITIAL_STATE);
  return (
    <form action={formAction} style={{ display: "grid", gap: "12px", maxWidth: 460 }}>
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
  );
}
