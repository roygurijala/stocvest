import type { CompositeTransportError } from "@/lib/api/composite-transport";
import {
  compositeStatusMessage,
  isInsufficientCompositeResponse,
  isLiquidityFilteredCompositeResponse
} from "@/lib/api/swing-composite";

export function resolveDeepDiveUnavailableMessage(opts: {
  symbol: string;
  cardVerdict: string;
  composite: Record<string, unknown> | null;
  transportError: CompositeTransportError | null;
  fetchErrorMessage: string | null;
}): string {
  const { symbol, cardVerdict, composite, transportError, fetchErrorMessage } = opts;
  if (transportError?.message) return transportError.message;
  if (fetchErrorMessage) return fetchErrorMessage;
  if (composite && isLiquidityFilteredCompositeResponse(composite)) {
    return composite.message;
  }
  if (composite && isInsufficientCompositeResponse(composite)) {
    const detail = compositeStatusMessage(composite);
    if (detail) {
      const layers =
        typeof composite.available_layers === "number" && typeof composite.required_layers === "number"
          ? ` (${composite.available_layers} of ${composite.required_layers} layers available)`
          : "";
      return `${detail}${layers}`;
    }
  }
  const statusMsg = compositeStatusMessage(composite);
  if (statusMsg) return statusMsg;
  if (cardVerdict.trim()) return cardVerdict.trim();
  return `Live analysis for ${symbol} is unavailable right now.`;
}
