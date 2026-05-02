"use client";

import type { BrokerOverview } from "@/lib/api/brokers";
import { OrderEntryPanel } from "@/components/order-entry-panel";

interface OrderEntryFormProps {
  brokerOverviews: BrokerOverview[];
}

/** @deprecated Use {@link OrderEntryPanel} — kept for import stability. */
export function OrderEntryForm(props: OrderEntryFormProps) {
  return <OrderEntryPanel {...props} />;
}
