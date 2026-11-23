import log from "electron-log";
import { printQueue } from "@/services/print-queue";
import { isKitchenTicketPrintingEnabled } from "@/services/printer-registry";
import { receiptPrintQueue } from "@/services/receipt-print-queue";
import { callScanbyApi, isScanbyApiConfigured } from "@/services/scanby-api";
import {
  type BroadcastCheck,
  checkOrderBroadcast,
  checkReceiptBroadcast,
} from "@/shared/broadcast-check";
import type { OrderPrintEvent, PrintOrder, PrintReceipt, ReceiptPrintEvent } from "@/shared/types";

/**
 * The broadcasts this station would otherwise print on their word alone:
 * kitchen updates, cancellations, reprints that name no relay job, and
 * receipts. Anyone holding the publishable key can send on a public channel,
 * so each is checked with the server first and the server's copy is what
 * prints — the same order or receipt the broadcast was built from, one short
 * request later. A server that does not answer leaves the broadcast to print
 * as before. New-order tickets and relay jobs need none of this: their claim
 * already returns the server's copy.
 */

/** Short: a kitchen ticket waiting on a slow answer is worse than an unchecked one. */
const CHECK_TIMEOUT_MS = 3_000;

type OrderCheckResponse = { order?: unknown; status?: unknown };
type ReceiptCheckResponse = { receipt?: unknown };

async function checkOrder(
  orderId: string,
  expectCancelled: boolean,
): Promise<BroadcastCheck<PrintOrder>> {
  if (!isScanbyApiConfigured()) {
    return { kind: "unchecked" };
  }
  const outcome = await callScanbyApi<OrderCheckResponse>(
    `/orders/${encodeURIComponent(orderId)}/print-payload`,
    { method: "GET", timeoutMs: CHECK_TIMEOUT_MS },
  );
  return checkOrderBroadcast(outcome, expectCancelled);
}

async function checkReceipt(receiptId: string): Promise<BroadcastCheck<PrintReceipt>> {
  if (!isScanbyApiConfigured()) {
    return { kind: "unchecked" };
  }
  const outcome = await callScanbyApi<ReceiptCheckResponse>(
    `/receipts/${encodeURIComponent(receiptId)}/print-payload`,
    { method: "GET", timeoutMs: CHECK_TIMEOUT_MS },
  );
  return checkReceiptBroadcast(outcome);
}

/** `order_updated`, or `order_reprint` without a relay job. */
export async function printOrderBroadcast(
  order: PrintOrder,
  event: Exclude<OrderPrintEvent, "order_created" | "order_cancelled">,
): Promise<void> {
  // The queue drops these anyway; no need to ask the server first.
  if (event !== "order_reprint" && !isKitchenTicketPrintingEnabled()) {
    printQueue.enqueue(order, { event });
    return;
  }
  const check = await checkOrder(order.id, false);
  if (check.kind === "refuted") {
    log.warn(`Ignoring ${event} for order ${order.id} — the server has no such order`);
    return;
  }
  printQueue.enqueue(check.kind === "confirmed" ? check.value : order, { event });
}

/** `order_cancelled`: an ΑΚΥΡΩΣΗ ticket only for an order the server cancelled. */
export async function printCancelBroadcast(orderId: string): Promise<void> {
  if (!isKitchenTicketPrintingEnabled()) {
    printQueue.enqueueCancel(orderId);
    return;
  }
  const check = await checkOrder(orderId, true);
  if (check.kind === "refuted") {
    log.warn(`Ignoring order_cancelled for order ${orderId} — the server has not cancelled it`);
    return;
  }
  printQueue.enqueueCancel(orderId);
}

/** `receipt_created`, or `receipt_reprint` without a relay job. */
export async function printReceiptBroadcast(
  receipt: PrintReceipt,
  event: ReceiptPrintEvent,
): Promise<void> {
  // Printed here already (the catch-up feed got there first): the queue skips it.
  if (event === "receipt_created" && receiptPrintQueue.hasReceipt(receipt.id)) {
    receiptPrintQueue.enqueue(receipt, { event });
    return;
  }
  const check = await checkReceipt(receipt.id);
  if (check.kind === "refuted") {
    log.warn(`Ignoring ${event} for receipt ${receipt.id} — the server has no such signed receipt`);
    return;
  }
  receiptPrintQueue.enqueue(check.kind === "confirmed" ? check.value : receipt, { event });
}
