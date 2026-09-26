import { randomUUID } from "node:crypto";
import log from "electron-log";
import { flashTrayIconRed } from "@/main/tray-effects";
import { claimOrderAutoPrint, isAutoPrintClaimConfigured } from "@/services/claim-order-auto-print";
import { claimRelayJob } from "@/services/claim-relay-job";
import { getConfig } from "@/services/config-store";
import {
  deliveredKeys,
  forgetDelivered,
  hasDelivered,
  markDelivered,
} from "@/services/delivered-ledger";
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
import {
  getRoutablePrinters,
  isKitchenTicketPrintingEnabled,
  withPrinterFontSize,
} from "@/services/printer-registry";
import { printOrder } from "@/services/printer-service";
import { showTrayNotification } from "@/services/tray-notifications";
import {
  AUTO_PRINT_MAX_AGE_MS,
  PRINT_RETRY_DELAYS_MS,
  PRINT_RETRY_NOTICE_AFTER,
  REPRINT_MAX_AGE_MS,
} from "@/shared/constants";
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
  /**
   * This station holds the server's claim — or the job needs none — and so
   * must print it. Persisted: a job restored after a restart must not claim
   * again, and must not be dropped either.
   */
  claimAcquired: boolean;
  /** The relay job a reprint was stored as; claimed before it prints. */
  relayJobId?: string;
  noticeShown?: boolean;
};

export function retryDelayMs(retryCount: number): number {
  const index = Math.min(Math.max(retryCount, 1), PRINT_RETRY_DELAYS_MS.length) - 1;
  return PRINT_RETRY_DELAYS_MS[index];
}

/** How long a job stays worth printing, from when this station took it on. */
export function maxAgeFor(event: OrderPrintEvent): number {
  return event === "order_reprint" ? REPRINT_MAX_AGE_MS : AUTO_PRINT_MAX_AGE_MS;
}

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
    ...(job.relayJobId ? { relayJobId: job.relayJobId } : {}),
    ...(job.noticeShown ? { noticeShown: true } : {}),
  };
}

function fromPersistedJob(job: PersistedQueueJob): QueueJob {
  return {
    ...job,
    claimAcquired: job.claimAcquired === true,
  };
}

/** What this job is remembered as once it is ours, so it never prints twice here. */
function deliveredKeyOf(job: Pick<QueueJob, "event" | "order" | "relayJobId">): string | null {
  if (job.relayJobId) {
    return deliveredKeys.relayJob(job.relayJobId);
  }
  if (job.event === "order_created") {
    return deliveredKeys.orderCreated(job.order.id);
  }
  return null;
}

type ClaimNeeded = "auto_print" | "relay" | null;

/**
 * A new-order ticket this app picked up from Realtime has to win the server-side
 * claim first — every other station heard the same broadcast. So does a
 * relayed reprint. Anything the dashboard hands us over the loopback API
 * arrives pre-claimed by its caller.
 */
function claimNeeded(job: QueueJob): ClaimNeeded {
  if (job.claimAcquired) {
    return null;
  }
  if (job.relayJobId) {
    return "relay";
  }
  return job.event === "order_created" ? "auto_print" : null;
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
    targets.map((target) =>
      printOrder(target.address, withPrinterFontSize(order, target), event, target.id),
    ),
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

/**
 * Tickets waiting for this station's printers, on disk so a restart loses
 * none of them. A job is retried — the claim if the server was unreachable,
 * the print if the printer was — until it prints or is too old to be worth
 * printing; it is never dropped after a fixed number of attempts.
 */
class PrintQueue {
  private queue: QueueJob[] = [];
  private retryPending = new Map<string, QueueJob>();
  private retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private processing = false;
  private restored = false;
  /**
   * The job being claimed or printed right now. Out of the queue but not done:
   * it is persisted, so a crash mid-print loses nothing, and counted as
   * pending, so a sweep landing meanwhile does not queue a second copy.
   */
  private current: QueueJob | null = null;

  private persistQueue(): void {
    const pending = [
      ...(this.current ? [toPersistedJob(this.current)] : []),
      ...this.queue.map(toPersistedJob),
      ...[...this.retryPending.values()].map(toPersistedJob),
    ];
    savePendingJobs(pending);
  }

  private findPending(predicate: (job: QueueJob) => boolean): QueueJob | undefined {
    if (this.current && predicate(this.current)) {
      return this.current;
    }
    return this.queue.find(predicate) ?? [...this.retryPending.values()].find(predicate);
  }

  /** Whether this station already has this order's new-order ticket, queued or printed. */
  hasOrderTicket(orderId: string): boolean {
    return (
      hasDelivered(deliveredKeys.orderCreated(orderId)) ||
      this.findPending((job) => job.event === "order_created" && job.order.id === orderId) !==
        undefined
    );
  }

  hasRelayJob(jobId: string): boolean {
    return (
      hasDelivered(deliveredKeys.relayJob(jobId)) ||
      this.findPending((job) => job.relayJobId === jobId) !== undefined
    );
  }

  clear(): void {
    for (const timer of this.retryTimers.values()) {
      clearTimeout(timer);
    }
    this.retryTimers.clear();
    this.queue = [];
    this.retryPending.clear();
    this.current = null;
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
      if (now - job.enqueuedAt > maxAgeFor(job.event)) {
        if (job.historyEntryId) {
          updatePrintStatus(job.historyEntryId, "failed", "Print job expired");
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
      /** The caller already holds the server-side claim for this job. */
      preClaimed?: boolean;
      /** The relay job this reprint is stored as; claimed before printing unless pre-claimed. */
      relayJobId?: string;
    } = {},
  ): boolean {
    const source = options.source ?? "realtime";
    const event = options.event ?? "order_created";
    const preClaimed = options.preClaimed === true;
    const relayJobId = options.relayJobId;
    const now = Date.now();

    // A venue that prints no kitchen tickets should not claim the order
    // either — the claim is what tells every other station to stand down.
    if (event !== "order_reprint" && !isKitchenTicketPrintingEnabled()) {
      log.info(`Kitchen ticket skipped for order ${order.id} — disabled for this business`);
      return false;
    }

    if (event === "order_created" && !preClaimed && !isAutoPrintClaimConfigured()) {
      log.warn(
        `Auto-print skipped for order ${order.id} — claim endpoint not configured; the dashboard prints this ticket instead`,
      );
      return false;
    }

    if (event === "order_created") {
      if (hasDelivered(deliveredKeys.orderCreated(order.id))) {
        log.info(`Skipping order ${order.id} — this station already took its new-order ticket`);
        return false;
      }
      const existing = this.findPending(
        (job) => job.event === "order_created" && job.order.id === order.id,
      );
      if (existing) {
        // The dashboard on this PC won the claim this job was about to ask
        // for: take the ticket as claimed instead of queueing a second copy.
        if (preClaimed && !existing.claimAcquired) {
          existing.claimAcquired = true;
          markDelivered(deliveredKeys.orderCreated(order.id));
          this.persistQueue();
          log.info(`Order ${order.id} handed over pre-claimed — using the queued job`);
          return true;
        }
        log.info(`Skipping duplicate new-order ticket for order ${order.id}`);
        return false;
      }
    }

    if (relayJobId && this.hasRelayJob(relayJobId)) {
      log.info(`Skipping relay job ${relayJobId} — already taken by this station`);
      return false;
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
      ...(relayJobId ? { relayJobId } : {}),
    };

    if (preClaimed) {
      const key = deliveredKeyOf(job);
      if (key) markDelivered(key);
    }

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

  /**
   * Waits for the job being printed right now. Retries waiting on a timer are
   * not waited for — they are on disk and resume when the app starts again,
   * and a printer that stays down must not hold up quitting.
   */
  async drain(): Promise<void> {
    while (this.processing) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  /** The job is no longer in flight — done, dropped or waiting on a timer. Call before persisting. */
  private settle(job: QueueJob): void {
    if (this.current === job) {
      this.current = null;
    }
  }

  private scheduleRetry(job: QueueJob, delayMs: number): void {
    this.settle(job);
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

  private isExpired(job: QueueJob, extraMs = 0): boolean {
    return Date.now() + extraMs - job.enqueuedAt > maxAgeFor(job.event);
  }

  /** The one place a job is given up on: it has grown too old to be worth printing. */
  private giveUp(job: QueueJob, message: string): void {
    this.settle(job);
    log.error(
      `Giving up on order ${job.order.id} (${job.event}) after ${job.retryCount} retries: ${message}`,
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
    showTrayNotification(
      t("notifications.orderFailed", { number: job.order.number }),
      formatFailureReason(message),
    );
    flashTrayIconRed();
  }

  private retryOrGiveUp(job: QueueJob, message: string): void {
    job.retryCount += 1;
    const delay = retryDelayMs(job.retryCount);
    if (this.isExpired(job, delay)) {
      this.giveUp(job, message);
      return;
    }
    log.warn(
      `Order ${job.order.id} (${job.event}) not printed yet (${message}) — retry ${job.retryCount} in ${delay}ms`,
    );
    this.scheduleRetry(job, delay);
  }

  /** Nothing went wrong: another station owns this job. A "failed" row would read as an error. */
  private drop(job: QueueJob, reason: string): void {
    this.settle(job);
    log.info(`Skipping print for order ${job.order.id} — ${reason}`);
    if (job.historyEntryId) {
      removePrintEntry(job.historyEntryId);
    }
    this.persistQueue();
  }

  /** Resolves true when the job is now this station's to print. */
  private async acquireClaim(job: QueueJob, needed: Exclude<ClaimNeeded, null>): Promise<boolean> {
    if (needed === "auto_print") {
      const result = await claimOrderAutoPrint(job.order.id);
      // The dashboard on this PC handed the ticket over while the request was
      // out — refused because the dashboard holds it. It is ours now.
      if (job.claimAcquired && result.kind !== "claimed") {
        return true;
      }
      switch (result.kind) {
        case "claimed":
          if (result.order) job.order = result.order;
          return true;
        case "retry":
          this.retryOrGiveUp(job, "Auto-print claim failed");
          return false;
        case "held":
          // A tab or phone is printing it. If it lets go, the sweep brings it back.
          this.drop(job, "another station is printing it");
          return false;
        case "lost":
          this.drop(job, "another station holds the claim");
          return false;
        case "unavailable":
          this.drop(job, "auto-print claim not configured");
          return false;
      }
    }

    const relayJobId = job.relayJobId ?? "";
    const result = await claimRelayJob(relayJobId);
    switch (result.kind) {
      case "claimed":
        if (result.order) job.order = result.order;
        return true;
      case "unclaimable":
        // Printing what it hears is what this build did before relay claims;
        // it reports so in its check-in, and the phones stand down for it.
        log.warn(`Relay job ${relayJobId} cannot be claimed — printing it as before`);
        // Now an ordinary reprint, as builds before relay claims made it.
        job.relayJobId = undefined;
        return true;
      case "retry":
        this.retryOrGiveUp(job, "Reprint claim failed");
        return false;
      case "held":
      case "lost":
        forgetDelivered(deliveredKeys.relayJob(relayJobId));
        this.drop(job, "another station took the reprint");
        return false;
    }
  }

  private async processQueue(): Promise<void> {
    if (this.processing) {
      return;
    }
    this.processing = true;

    while (this.queue.length > 0) {
      this.current = null;
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
      this.current = job;

      if (this.isExpired(job)) {
        this.giveUp(job, "Print job expired");
        continue;
      }

      const needed = claimNeeded(job);
      if (needed) {
        if (!(await this.acquireClaim(job, needed))) {
          continue;
        }
        job.claimAcquired = true;
        const key = deliveredKeyOf(job);
        if (key) markDelivered(key);
        this.persistQueue();
      }

      try {
        await printOrderOnEveryKitchenPrinter(job.order, job.event, config.printerIp);
        this.settle(job);
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
        if (job.noticeShown) {
          showTrayNotification(
            t("notifications.orderPrintedAfterRetry", { number: job.order.number }),
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Print failed";
        if (!job.noticeShown && job.retryCount + 1 >= PRINT_RETRY_NOTICE_AFTER) {
          job.noticeShown = true;
          showTrayNotification(
            t("notifications.orderWaiting", { number: job.order.number }),
            formatFailureReason(message),
          );
          flashTrayIconRed();
        }
        this.retryOrGiveUp(job, message);
      }
    }

    this.current = null;
    this.persistQueue();
    this.processing = false;
  }
}

export const printQueue = new PrintQueue();
