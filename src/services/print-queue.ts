import { randomUUID } from "node:crypto";
import log from "electron-log";
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
  updatePrintStatus,
} from "@/services/print-history-store";
import { printOrder } from "@/services/printer-service";
import { showTrayNotification } from "@/services/tray-notifications";
import { PENDING_JOB_MAX_AGE_MS, PRINT_DEDUPE_MS, PRINT_RETRY_DELAYS_MS } from "@/shared/constants";
import type { OrderPrintEvent, PrintHistorySource, PrintOrder } from "@/shared/types";

type QueueJob = {
  id: string;
  order: PrintOrder;
  event: OrderPrintEvent;
  source: PrintHistorySource;
  historyEntryId: string | null;
  enqueuedAt: number;
  retryCount: number;
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
  };
}

function fromPersistedJob(job: PersistedQueueJob): QueueJob {
  return { ...job };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    options: { source?: PrintHistorySource; event?: OrderPrintEvent } = {},
  ): boolean {
    const source = options.source ?? "realtime";
    const event = options.event ?? "order_created";
    const now = Date.now();

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

      try {
        await printOrder(config.printerIp, job.order, job.event);
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

        showTrayNotification(
          "Print failed",
          `Order #${job.order.number} (table ${job.order.table}) could not be printed.`,
        );
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
