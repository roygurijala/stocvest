"use client";

import { useFormState, useFormStatus } from "react-dom";
import { submitOrderAction, type OrderActionState } from "@/app/dashboard/actions";
import type { BrokerOverview } from "@/lib/api/brokers";

interface OrderEntryFormProps {
  brokerOverviews: BrokerOverview[];
}

const INITIAL_STATE: OrderActionState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}>
      {pending ? "Submitting..." : "Place Order"}
    </button>
  );
}

export function OrderEntryForm({ brokerOverviews }: OrderEntryFormProps) {
  const [state, action] = useFormState(submitOrderAction, INITIAL_STATE);
  const accountOptions = brokerOverviews.flatMap((overview) =>
    (overview.accounts || []).map((account) => ({
      broker: overview.broker,
      accountId: account.account_id,
      label: `${overview.broker.toUpperCase()} — ${account.display_name || account.account_id}`
    }))
  );

  return (
    <section style={{ marginTop: 18, background: "#101a32", borderRadius: 12, padding: 16 }}>
      <h2 style={{ marginTop: 0 }}>Order Entry</h2>
      <form action={action} style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
        <label>
          Broker
          <select name="broker" defaultValue={accountOptions[0]?.broker || "mock"}>
            <option value="mock">mock</option>
            <option value="ibkr">ibkr</option>
            <option value="etrade">etrade</option>
          </select>
        </label>
        <label>
          Account
          <select name="account_id" defaultValue={accountOptions[0]?.accountId || ""}>
            {accountOptions.length === 0 ? (
              <option value="">No accounts available</option>
            ) : (
              accountOptions.map((option) => (
                <option key={`${option.broker}-${option.accountId}`} value={option.accountId}>
                  {option.label}
                </option>
              ))
            )}
          </select>
        </label>
        <label>
          Symbol
          <input name="symbol" defaultValue="SPY" />
        </label>
        <label>
          Side
          <select name="side" defaultValue="buy">
            <option value="buy">buy</option>
            <option value="sell">sell</option>
          </select>
        </label>
        <label>
          Quantity
          <input name="quantity" type="number" min="0.0001" step="0.0001" defaultValue="1" />
        </label>
        <label>
          Order Type
          <select name="order_type" defaultValue="market">
            <option value="market">market</option>
            <option value="limit">limit</option>
            <option value="stop">stop</option>
            <option value="stop_limit">stop_limit</option>
          </select>
        </label>
        <label>
          Time in Force
          <select name="time_in_force" defaultValue="day">
            <option value="day">day</option>
            <option value="gtc">gtc</option>
            <option value="ioc">ioc</option>
            <option value="fok">fok</option>
          </select>
        </label>
        <label>
          Limit Price
          <input name="limit_price" type="number" min="0.0001" step="0.0001" />
        </label>
        <label>
          Stop Price
          <input name="stop_price" type="number" min="0.0001" step="0.0001" />
        </label>
        <div style={{ display: "flex", alignItems: "end" }}>
          <SubmitButton />
        </div>
      </form>
      {state.error ? <p style={{ color: "#fda4af", marginBottom: 0 }}>{state.error}</p> : null}
      {state.success ? <p style={{ color: "#4ade80", marginBottom: 0 }}>{state.success}</p> : null}
    </section>
  );
}
