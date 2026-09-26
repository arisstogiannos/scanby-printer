import log from "electron-log";
import { canPrintDocument } from "@/services/can-print-document";
import { claimOrderAutoPrint, releaseOrderAutoPrint } from "@/services/claim-order-auto-print";
import { claimRelayJob, releaseRelayJob } from "@/services/claim-relay-job";
import { getConfig } from "@/services/config-store";
import { getReceiptWatermark, setReceiptWatermark } from "@/services/delivered-ledger";
import { printQueue } from "@/services/print-queue";
import { isKitchenTicketPrintingEnabled } from "@/services/printer-registry";
import { receiptPrintQueue } from "@/services/receipt-print-queue";
import { callScanbyApi, isScanbyApiConfigured } from "@/services/scanby-api";
import { PRINT_SWEEP_INTERVAL_MS } from "@/shared/constants";
import { normalizePrintReceipt } from "@/shared/receipt-payload";
import type { PrintDocumentClass } from "@/shared/types";

/**
 * Asks the server for what this station should be printing but never heard
 * about. Broadcasts are sent once and never replayed: one that goes out while
 * the channel is reconnecting is gone. So on every (re)subscribe, and every
 * half minute besides, this catches up on:
 *
 * - new-order tickets nobody printed, or whose tab or phone claimed them and
 *   then vanished;
 * - reprints asked for on a device with no printer that nobody took;
 * - receipts signed since the last look (every receipt prints here, as with
 *   the `receipt_created` broadcast).
 *
 * All three go through the same claims and the same queues as the broadcast
 * path, so a job found both ways prints once.
 */

/** A restart shorter than this (an update) picks the receipt feed up where it left off. */
const RECEIPT_RESUME_WINDOW_MS = 5 * 60 * 1000;
/** Re-reads a few seconds before the watermark, in case a receipt committed out of order. */
const RECEIPT_OVERLAP_MS = 5_000;
const RECEIPT_FEED_LIMIT = 20;

const RELAY_DOCUMENTS: readonly PrintDocumentClass[] = [
  "kitchen_ticket",
  "order_slip",
  "fiscal_receipt",
];

type PendingOrdersResponse = { orders?: Array<{ id?: unknown }> };
type PendingRelayJobsResponse = { jobs?: Array<{ id?: unknown; document?: unknown }> };
type ReceiptFeedResponse = {
  receipts?: Array<{ signedAt?: unknown; receipt?: unknown }>;
  serverTime?: unknown;
};

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;
let rerun = false;
/** Server time the receipt feed has read up to; null until the first look sets a baseline. */
let receiptWatermark: string | null = null;

async function sweepPendingOrders(): Promise<void> {
  // The server says the same, but asking costs a request and a claim.
  if (!isKitchenTicketPrintingEnabled()) {
    return;
  }
  const result = await callScanbyApi<PendingOrdersResponse>("/orders/pending-print", {
    method: "GET",
  });
  if (result.kind !== "ok") {
    return;
  }

  for (const entry of result.data.orders ?? []) {
    const orderId = typeof entry.id === "string" ? entry.id : null;
    if (!orderId || printQueue.hasOrderTicket(orderId)) {
      continue;
    }
    const claim = await claimOrderAutoPrint(orderId);
    if (claim.kind !== "claimed") {
      continue;
    }
    if (!claim.order) {
      // Nothing to print from: hand it back rather than hold a ticket no one prints.
      log.warn(`Swept order ${orderId} claimed without a ticket — handing it back`);
      await releaseOrderAutoPrint(orderId);
      continue;
    }
    log.info(`Sweep found unprinted order ${orderId} — printing it`);
    printQueue.enqueue(claim.order, { event: "order_created", preClaimed: true });
  }
}

/**
 * Resolves false when the server cannot be swept: unreachable, or a build from
 * before sweeps, whose claims send no ticket back — so the order sweep must
 * not run against it either.
 */
async function sweepPendingRelayJobs(): Promise<boolean> {
  const result = await callScanbyApi<PendingRelayJobsResponse>("/print-relay-jobs/pending", {
    method: "GET",
  });
  if (result.kind !== "ok") {
    return false;
  }

  for (const entry of result.data.jobs ?? []) {
    const jobId = typeof entry.id === "string" ? entry.id : null;
    const document = RELAY_DOCUMENTS.includes(entry.document as PrintDocumentClass)
      ? (entry.document as PrintDocumentClass)
      : null;
    if (
      !jobId ||
      !document ||
      printQueue.hasRelayJob(jobId) ||
      receiptPrintQueue.hasRelayJob(jobId)
    ) {
      continue;
    }
    // A claim here never lapses: take only what this station can put on paper.
    if (!canPrintDocument(document)) {
      continue;
    }
    const claim = await claimRelayJob(jobId);
    if (claim.kind !== "claimed") {
      continue;
    }
    log.info(`Sweep found relayed reprint ${jobId} — printing it`);
    const queued = claim.order
      ? printQueue.enqueue(claim.order, {
          source: "manual",
          event: "order_reprint",
          preClaimed: true,
          relayJobId: jobId,
        })
      : claim.receipt
        ? receiptPrintQueue.enqueue(claim.receipt, {
            source: "manual",
            event: "receipt_reprint",
            preClaimed: true,
            relayJobId: jobId,
          })
        : false;
    if (!queued) {
      // Claimed but not taken on: hand it back rather than hold it unprinted.
      log.warn(`Relayed reprint ${jobId} was not queued — handing it back`);
      await releaseRelayJob(jobId);
    }
  }
  return true;
}

async function sweepSignedReceipts(): Promise<void> {
  const since = receiptWatermark;
  const query = since
    ? `?since=${encodeURIComponent(new Date(Date.parse(since) - RECEIPT_OVERLAP_MS).toISOString())}`
    : "";
  const result = await callScanbyApi<ReceiptFeedResponse>(`/receipts/print-feed${query}`, {
    method: "GET",
  });
  if (result.kind !== "ok") {
    return;
  }

  const entries = result.data.receipts ?? [];
  for (const entry of entries) {
    const receipt = normalizePrintReceipt(entry.receipt ?? null);
    if (!receipt || receiptPrintQueue.hasReceipt(receipt.id)) {
      continue;
    }
    log.info(`Receipt feed found ${receipt.series} ${receipt.aa} not printed here — printing it`);
    receiptPrintQueue.enqueue(receipt, { event: "receipt_created" });
  }

  // A full page may have more behind it: resume from its last receipt, not
  // from now, so the rest are read on the next sweep instead of skipped.
  const last = entries.at(-1);
  const next =
    entries.length >= RECEIPT_FEED_LIMIT && typeof last?.signedAt === "string"
      ? last.signedAt
      : typeof result.data.serverTime === "string"
        ? result.data.serverTime
        : null;
  if (next) {
    receiptWatermark = next;
    setReceiptWatermark(next);
  }
}

async function runSweep(): Promise<void> {
  // A station without a printer set up must not claim what it cannot print —
  // a phone that can would be told the ticket is taken.
  if (!isScanbyApiConfigured() || !getConfig()?.printerIp) {
    return;
  }
  if (running) {
    rerun = true;
    return;
  }
  running = true;
  try {
    if (await sweepPendingRelayJobs()) {
      await sweepPendingOrders();
      await sweepSignedReceipts();
    }
  } catch (error) {
    log.warn("Print sweep failed", error);
  } finally {
    running = false;
    if (rerun) {
      rerun = false;
      void runSweep();
    }
  }
}

/** Sweeps now — the channel just (re)subscribed, so whatever it missed is waiting. */
export function requestPrintSweep(): void {
  void runSweep();
}

export function startPrintSweeps(): void {
  if (!isScanbyApiConfigured()) {
    log.info("Print sweeps skipped — SCANBY_API_URL, PRINT_CLAIM_SECRET, or pairing not set");
    return;
  }
  if (timer) {
    requestPrintSweep();
    return;
  }
  receiptWatermark = getReceiptWatermark(RECEIPT_RESUME_WINDOW_MS);
  timer = setInterval(() => void runSweep(), PRINT_SWEEP_INTERVAL_MS);
  log.info(`Print sweeps started (every ${PRINT_SWEEP_INTERVAL_MS / 1_000}s)`);
  requestPrintSweep();
}

export function stopPrintSweeps(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  receiptWatermark = null;
}
