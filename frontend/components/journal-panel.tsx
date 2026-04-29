"use client";

import { useFormState, useFormStatus } from "react-dom";
import type { JournalEntryPayload } from "@/lib/api/contracts";
import { createJournalEntryAction, type JournalActionState } from "@/app/dashboard/journal-actions";

interface JournalPanelProps {
  entries: JournalEntryPayload[];
}

const INITIAL_STATE: JournalActionState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending}>{pending ? "Saving..." : "Add Entry"}</button>;
}

export function JournalPanel({ entries }: JournalPanelProps) {
  const [state, action] = useFormState(createJournalEntryAction, INITIAL_STATE);

  return (
    <section style={{ marginTop: 18, background: "#101a32", borderRadius: 12, padding: 16 }}>
      <h2 style={{ marginTop: 0 }}>Trade Journal</h2>
      <form action={action} style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
        <label>
          Symbol
          <input name="symbol" defaultValue="AAPL" />
        </label>
        <label>
          Side
          <select name="opening_side" defaultValue="buy">
            <option value="buy">buy</option>
            <option value="sell">sell</option>
          </select>
        </label>
        <label>
          Quantity
          <input name="quantity" type="number" min="0.0001" step="0.0001" defaultValue="1" />
        </label>
        <label>
          Day Trade
          <select name="is_day_trade" defaultValue="true">
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        </label>
        <label>
          Strategy Tags
          <input name="strategy_tags" placeholder="orb,vwap" />
        </label>
        <label>
          Notes
          <input name="entry_notes" placeholder="setup notes" />
        </label>
        <div style={{ display: "flex", alignItems: "end" }}>
          <SubmitButton />
        </div>
      </form>
      {state.error ? <p style={{ color: "#fda4af" }}>{state.error}</p> : null}
      {state.success ? <p style={{ color: "#4ade80" }}>{state.success}</p> : null}

      <h3>Recent Entries</h3>
      {entries.length === 0 ? (
        <p style={{ opacity: 0.85 }}>No entries yet.</p>
      ) : (
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {entries.slice(0, 8).map((entry) => (
            <li key={entry.entry_id}>
              {entry.symbol} {entry.opening_side} {entry.quantity} ({entry.status})
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
