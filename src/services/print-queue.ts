import log from "electron-log";
import { getConfig } from "@/services/config-store";
import {
  findLatestEntryByOrderId,
  findLatestOrderById,
  recordPrint,
  updatePrintStatus,
} from "@/services/print-history-store";
import { printOrder } from "@/services/printer-service";
import { PRINT_DEDUPE_MS } from "@/shared/constants";
import type { OrderPrintEvent, PrintHistorySource, PrintOrder } from "@/shared/types";

type QueueJob = {
  order: PrintOrder;
  event: OrderPrintEvent;
  source: PrintHistorySource;
  historyEntryId: string | null;
  enqueuedAt: number;
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

class PrintQueue {
  private queue: QueueJob[] = [];
  private processing = false;
  private recentPrints = new Map<string, number>();

  private dedupeKey(orderId: string, event: OrderPrintEvent): string {
    return `${orderId}:${event}`;
  }

  private shouldDedupe(event: OrderPrintEvent): boolean {
    return event === "order_created";
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

    this.queue.push({ order, event, source, historyEntryId, enqueuedAt: now });
    void this.processQueue();
    return true;
  }

  enqueueCancel(orderId: string): boolean {
    const knownOrder = findLatestOrderById(orderId);
    const order = buildCancelOrder(orderId, knownOrder);
    return this.enqueue(order, { event: "order_cancelled" });
  }

  async drain(): Promise<void> {
    while (this.processing || this.queue.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
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
        break;
      }

      try {
        await printOrder(config.printerIp, job.order, job.event);
        this.recentPrints.set(this.dedupeKey(job.order.id, job.event), Date.now());
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
        log.error(`Failed to print order ${job.order.id} (${job.event})`, error);
        const message = error instanceof Error ? error.message : "Print failed";
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
      }
    }

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
