import { normalizePrintOrder } from "@/shared/print-payload";
import { normalizePrintReceipt } from "@/shared/receipt-payload";
import type { PrintOrder, PrintReceipt } from "@/shared/types";

/**
 * A broadcast is a wake-up, not an instruction: before printing what one
 * carries, this station asks the server for its own copy. Only a server that
 * answers decides; one that cannot be reached leaves the broadcast to print
 * as it always did, so a slow connection never costs the kitchen a ticket.
 */
export type BroadcastCheck<T> =
  /** The server's copy, which is what prints. */
  | { kind: "confirmed"; value: T }
  /** The server has no such document for this venue: the broadcast was not its. */
  | { kind: "refuted" }
  /** The server could not say; print the broadcast's copy, as before. */
  | { kind: "unchecked" };

/** The subset of `callScanbyApi`'s result these checks read. */
export type CheckOutcome<T> =
  | { kind: "ok"; data: T }
  | { kind: "retry" }
  | { kind: "rejected"; status: number }
  | { kind: "unavailable" };

/** An order's broadcast may claim it was cancelled; these are the statuses that say so. */
const CANCELLED_STATUSES = ["CANCELLED", "DECLINED"];

type OrderCheckResponse = { order?: unknown; status?: unknown };
type ReceiptCheckResponse = { receipt?: unknown };

/**
 * `order_updated` and `order_reprint` print the server's ticket for the order;
 * `order_cancelled` prints only for an order the server has cancelled.
 */
export function checkOrderBroadcast(
  outcome: CheckOutcome<OrderCheckResponse>,
  expectCancelled: boolean,
): BroadcastCheck<PrintOrder> {
  if (outcome.kind !== "ok") {
    return { kind: "unchecked" };
  }
  if (outcome.data.order === null) {
    return { kind: "refuted" };
  }
  const order = normalizePrintOrder(outcome.data.order ?? null);
  if (!order) {
    return { kind: "unchecked" };
  }
  if (expectCancelled && !CANCELLED_STATUSES.includes(String(outcome.data.status))) {
    return { kind: "refuted" };
  }
  return { kind: "confirmed", value: order };
}

/** A receipt prints only as the server signed it. */
export function checkReceiptBroadcast(
  outcome: CheckOutcome<ReceiptCheckResponse>,
): BroadcastCheck<PrintReceipt> {
  if (outcome.kind !== "ok") {
    return { kind: "unchecked" };
  }
  if (outcome.data.receipt === null) {
    return { kind: "refuted" };
  }
  const receipt = normalizePrintReceipt(outcome.data.receipt ?? null);
  return receipt ? { kind: "confirmed", value: receipt } : { kind: "unchecked" };
}
