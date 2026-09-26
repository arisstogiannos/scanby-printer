import { randomUUID } from "node:crypto";
import log from "electron-log";
import { flashTrayIconRed } from "@/main/tray-effects";
import { claimOrderAutoPrint, isAutoPrintClaimConfigured } from "@/services/claim-order-auto-print";
import { getConfig } from "@/services/config-store";
import {
  loadPendingJobs,
  type PersistedQueueJob,
  savePendingJobs,
} from "@/services/pending-print-queue-store";
import {
  findLatestEntryByOrderId,
  findLatestOrderById,
  recordPrint,
  removePrintEntry,
  updatePrintStatus,
} from "@/services/print-history-store";
import { getRoutablePrinters, isKitchenTicketPrintingEnabled } from "@/services/printer-registry";
import { printOrder } from "@/services/printer-service";
import { showTrayNotification } from "@/services/tray-notifications";
import { PENDING_JOB_MAX_AGE_MS, PRINT_DEDUPE_MS, PRINT_RETRY_DELAYS_MS } from "@/shared/constants";
import { t } from "@/shared/i18n";
import { selectPrintTargets } from "@/shared/printer-routing";
import type { OrderPrintEvent, PrintHistorySource, PrintOrder } from "@/shared/types";

type QueueJob = {
  id: string;
  order: PrintOrder;
  event: OrderPrintEvent;
  source: PrintHistorySource;
  historyEntryId: string | null;
  enqueuedAt: number;
  retryCount: number;
  claimAcquired: boolean;
};

function buildCancelOrder(orderId: string, order?: PrintOrder | null): PrintOrder {
  if (order) {
    return { ...order, items: [] };
  }

  const entry = findLatestEntryByOrderId(orderId);
  const createdAt = entry?.payload?.createdAt ?? entry?.printedAt ?? new Date().toISOString();
  return {
    id: orderId,
    number: entry?.orderNumber ?? 0,
    table: entry?.table ?? "?",
    items: [],
    createdAt,
  };
}

function toPersistedJob(job: QueueJob): PersistedQueueJob {
  return {
    id: job.id,
    order: job.order,
    event: job.event,
    source: job.source,
    historyEntryId: job.historyEntryId,
    enqueuedAt: job.enqueuedAt,
    retryCount: job.retryCount,
    ...(job.claimAcquired ? { claimAcquired: true } : {}),
  };
}

function fromPersistedJob(job: PersistedQueueJob): QueueJob {
  return {
    ...job,
    claimAcquired: job.claimAcquired === true,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A new-order ticket this app picked up from Realtime has to win the server-side
 * claim first — every other station heard the same broadcast. Anything the
 * dashboard hands us over the loopback API arrives pre-claimed by its caller.
 */
function requiresAutoPrintClaim(event: OrderPrintEvent, preClaimed: boolean): boolean {
  return event === "order_created" && !preClaimed;
}

function formatFailureReason(errorMessage: string): string {
  const lower = errorMessage.toLowerCase();
  if (
    lower.includes("offline") ||
    lower.includes("unreachable") ||
    lower.includes("econnrefused")
  ) {
    return "printer offline";
  }
  return errorMessage;
}

/**
 * Prints one ticket on every kitchen printer the venue has.
 *
 * Fan-out, not first-match: a bar printer and a grill printer both set to
 * `KITCHEN` each want the whole ticket. The job only fails — and so only
 * retries — if *no* printer took it; a venue with two printers and one jammed
 * roll still gets its order to the kitchen, and the failure is logged rather
 * than replayed onto the printer that already produced the ticket.
 */
async function printOrderOnEveryKitchenPrinter(
  order: PrintOrder,
  event: OrderPrintEvent,
  fallbackIp: string,
): Promise<void> {
  const targets = selectPrintTargets(getRoutablePrinters(), "kitchen_ticket");

  if (targets.length === 0) {
    // No registry yet, or no printer holds the kitchen role. The configured
    // printer is what this app has always used; keep using it rather than
    // silently dropping the venue's tickets on an upgrade.
    await printOrder(fallbackIp, order, event);
    return;
  }

  const results = await Promise.allSettled(
    targets.map((target) => printOrder(target.address, order, event, target.id)),
  );

  const failures = results.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );

  if (failures.length < results.length) {
    for (const failure of failures) {
      log.warn(`Kitchen ticket for order ${order.id} failed on one printer`, failure.reason);
    }
    return;
  }

  throw failures[0]?.reason instanceof Error
    ? failures[0].reason
    : new Error("Kitchen ticket failed on every printer");
}

class PrintQueue {
  private queue: QueueJob[] = [];
  private retryPending = new Map<string, QueueJob>();
  private retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private processing = false;
  private recentPrints = new Map<string, number>();
  private restored = false;

  private dedupeKey(orderId: string, event: OrderPrintEvent): string {
    return `${orderId}:${event}`;
  }

  private shouldDedupe(event: OrderPrintEvent): boolean {
    return event === "order_created";
  }

  private persistQueue(): void {
    const pending = [
      ...this.queue.map(toPersistedJob),
      ...[...this.retryPending.values()].map(toPersistedJob),
    ];
    savePendingJobs(pending);
  }

  clear(): void {
    for (const timer of this.retryTimers.values()) {
      clearTimeout(timer);
    }
    this.retryTimers.clear();
    this.queue = [];
    this.retryPending.clear();
    this.processing = false;
    this.restored = false;
    savePendingJobs([]);
  }

  restorePendingJobs(): void {
    if (this.restored) {
      return;
    }
    this.restored = true;

    const now = Date.now();
    const pending = loadPendingJobs();
    const restoredJobs: QueueJob[] = [];

    for (const job of pending) {
      if (now - job.enqueuedAt > PENDING_JOB_MAX_AGE_MS) {
        if (job.historyEntryId) {
          updatePrintStatus(job.historyEntryId, "failed", "Print job expired after 24h");
        }
        continue;
      }
      restoredJobs.push(fromPersistedJob(job));
    }

    this.queue.push(...restoredJobs);
    savePendingJobs(this.queue.map(toPersistedJob));

    if (this.queue.length > 0) {
      log.info(`Restored ${this.queue.length} pending print job(s) from disk`);
      void this.processQueue();
    }
  }

  enqueue(
    order: PrintOrder,
    options: {
      source?: PrintHistorySource;
      event?: OrderPrintEvent;
      /** The caller already holds the server-side auto-print claim for this order. */
      preClaimed?: boolean;
    } = {},
  ): boolean {
    const source = options.source ?? "realtime";
    const event = options.event ?? "order_created";
    const preClaimed = options.preClaimed === true;
    const now = Date.now();

    // A venue that prints no kitchen tickets should not claim the order
    // either — the claim is what tells every other station to stand down.
    if (event !== "order_reprint" && !isKitchenTicketPrintingEnabled()) {
      log.info(`Kitchen ticket skipped for order ${order.id} — disabled for this business`);
      return false;
    }

    if (requiresAutoPrintClaim(event, preClaimed) && !isAutoPrintClaimConfigured()) {
      log.warn(
        `Auto-print skipped for order ${order.id} — claim endpoint not configured; the dashboard prints this ticket instead`,
      );
      return false;
    }

    if (this.shouldDedupe(event)) {
      const lastPrinted = this.recentPrints.get(this.dedupeKey(order.id, event));
      if (lastPrinted !== undefined && now - lastPrinted < PRINT_DEDUPE_MS) {
        log.info(`Skipping duplicate print for order ${order.id} (${event})`);
        return false;
      }
    }

    const historyEntryId =
      source === "test"
        ? null
        : recordPrint({
            orderId: order.id,
            orderNumber: order.number,
            table: order.table,
            source,
            status: "received",
            payload: order,
          }).id;

    const job: QueueJob = {
      id: randomUUID(),
      order,
      event,
      source,
      historyEntryId,
      enqueuedAt: now,
      retryCount: 0,
      claimAcquired: preClaimed,
    };

    this.queue.push(job);
    this.persistQueue();
    void this.processQueue();
    return true;
  }

  enqueueCancel(orderId: string): boolean {
    const knownOrder = findLatestOrderById(orderId);
    const order = buildCancelOrder(orderId, knownOrder);
    return this.enqueue(order, { event: "order_cancelled" });
  }

  async drain(): Promise<void> {
    while (this.processing || this.queue.length > 0 || this.retryPending.size > 0) {
      await sleep(100);
    }
  }

  private scheduleRetry(job: QueueJob, delayMs: number): void {
    this.retryPending.set(job.id, job);
    this.persistQueue();
    const timer = setTimeout(() => {
      this.retryTimers.delete(job.id);
      this.retryPending.delete(job.id);
      this.queue.unshift(job);
      this.persistQueue();
      void this.processQueue();
    }, delayMs);
    this.retryTimers.set(job.id, timer);
  }

  private async processQueue(): Promise<void> {
    if (this.processing) {
      return;
    }
    this.processing = true;

    while (this.queue.length > 0) {
      const job = this.queue.shift();
      if (!job) {
        break;
      }

      const config = getConfig();
      if (!config?.printerIp) {
        log.warn(`Print job for order ${job.order.id} waiting — no printer configured`);
        this.queue.unshift(job);
        this.persistQueue();
        break;
      }

      if (requiresAutoPrintClaim(job.event, job.claimAcquired)) {
        const claimResult = await claimOrderAutoPrint(job.order.id);

        if (claimResult === "claimed") {
          job.claimAcquired = true;
          this.persistQueue();
        } else if (claimResult === "retry") {
          job.retryCount += 1;
          if (job.retryCount <= PRINT_RETRY_DELAYS_MS.length) {
            const delay =
              PRINT_RETRY_DELAYS_MS[job.retryCount - 1] ??
              PRINT_RETRY_DELAYS_MS[PRINT_RETRY_DELAYS_MS.length - 1];
            log.warn(
              `Auto-print claim failed for order ${job.order.id}, retry ${job.retryCount}/${PRINT_RETRY_DELAYS_MS.length} in ${delay}ms`,
            );
            this.scheduleRetry(job, delay);
            continue;
          }

          log.error(
            `Auto-print claim failed for order ${job.order.id} after ${PRINT_RETRY_DELAYS_MS.length + 1} attempts`,
          );
          if (job.historyEntryId) {
            updatePrintStatus(job.historyEntryId, "failed", "Auto-print claim failed");
          }
          this.persistQueue();
          continue;
        } else {
          const reason =
            claimResult === "unavailable"
              ? "auto-print claim not configured"
              : "another station holds the claim";
          log.info(`Skipping print for order ${job.order.id} — ${reason}`);
          // Nothing was printed and nothing went wrong: the dashboard or another
          // station owns this ticket. A "failed" row here would read as an error
          // and sit next to the copy that did print.
          if (job.historyEntryId) {
            removePrintEntry(job.historyEntryId);
          }
          this.persistQueue();
          continue;
        }
      }

      try {
        await printOrderOnEveryKitchenPrinter(job.order, job.event, config.printerIp);
        this.recentPrints.set(this.dedupeKey(job.order.id, job.event), Date.now());
        this.persistQueue();
        if (job.historyEntryId) {
          updatePrintStatus(job.historyEntryId, "printed");
        } else {
          recordPrint({
            orderId: job.order.id,
            orderNumber: job.order.number,
            table: job.order.table,
            source: job.source,
            status: "printed",
            payload: job.order,
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Print failed";
        job.retryCount += 1;

        if (job.retryCount <= PRINT_RETRY_DELAYS_MS.length) {
          const delay =
            PRINT_RETRY_DELAYS_MS[job.retryCount - 1] ??
            PRINT_RETRY_DELAYS_MS[PRINT_RETRY_DELAYS_MS.length - 1];
          log.warn(
            `Print failed for order ${job.order.id} (${job.event}), retry ${job.retryCount}/${PRINT_RETRY_DELAYS_MS.length} in ${delay}ms`,
            error,
          );
          this.scheduleRetry(job, delay);
          continue;
        }

        log.error(
          `Failed to print order ${job.order.id} (${job.event}) after ${PRINT_RETRY_DELAYS_MS.length + 1} attempts`,
          error,
        );
        this.persistQueue();
        if (job.historyEntryId) {
          updatePrintStatus(job.historyEntryId, "failed", message);
        } else {
          recordPrint({
            orderId: job.order.id,
            orderNumber: job.order.number,
            table: job.order.table,
            source: job.source,
            status: "failed",
            payload: job.order,
            error: message,
          });
        }

        const failureReason = formatFailureReason(message);

        showTrayNotification(
          t("notifications.orderFailed", { number: job.order.number }),
          failureReason,
        );
        flashTrayIconRed();
      }
    }

    this.persistQueue();
    this.processing = false;
    this.pruneRecentPrints();
  }

  private pruneRecentPrints(): void {
    const now = Date.now();
    for (const [key, printedAt] of this.recentPrints) {
      if (now - printedAt > PRINT_DEDUPE_MS) {
        this.recentPrints.delete(key);
      }
    }
  }
}

export const printQueue = new PrintQueue();
