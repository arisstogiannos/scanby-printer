import { randomUUID } from "node:crypto";
import log from "electron-log";
import { flashTrayIconRed } from "@/main/tray-effects";
import { getConfig } from "@/services/config-store";
import { printReceipt } from "@/services/printer-service";
import { showTrayNotification } from "@/services/tray-notifications";
import { PRINT_DEDUPE_MS, PRINT_RETRY_DELAYS_MS } from "@/shared/constants";
import { t } from "@/shared/i18n";
import type { PrintHistorySource, PrintReceipt, ReceiptPrintEvent } from "@/shared/types";

type ReceiptQueueJob = {
  id: string;
  receipt: PrintReceipt;
  event: ReceiptPrintEvent;
  source: PrintHistorySource;
  enqueuedAt: number;
  retryCount: number;
};

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

class ReceiptPrintQueue {
  private queue: ReceiptQueueJob[] = [];
  private retryPending = new Map<string, ReceiptQueueJob>();
  private retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private processing = false;
  private recentPrints = new Map<string, number>();

  private dedupeKey(receiptId: string): string {
    return receiptId;
  }

  private shouldDedupe(): boolean {
    return true;
  }

  clear(): void {
    for (const timer of this.retryTimers.values()) {
      clearTimeout(timer);
    }
    this.retryTimers.clear();
    this.queue = [];
    this.retryPending.clear();
    this.processing = false;
  }

  enqueue(
    receipt: PrintReceipt,
    options: { source?: PrintHistorySource; event?: ReceiptPrintEvent } = {},
  ): boolean {
    const source = options.source ?? "realtime";
    const event = options.event ?? "receipt_created";
    const now = Date.now();

    if (this.shouldDedupe()) {
      const lastPrinted = this.recentPrints.get(this.dedupeKey(receipt.id));
      if (lastPrinted !== undefined && now - lastPrinted < PRINT_DEDUPE_MS) {
        log.info(`Skipping duplicate receipt print for ${receipt.id} (${event})`);
        return false;
      }
    }

    const job: ReceiptQueueJob = {
      id: randomUUID(),
      receipt,
      event,
      source,
      enqueuedAt: now,
      retryCount: 0,
    };

    this.queue.push(job);
    void this.processQueue();
    return true;
  }

  private scheduleRetry(job: ReceiptQueueJob, delayMs: number): void {
    this.retryPending.set(job.id, job);
    const timer = setTimeout(() => {
      this.retryTimers.delete(job.id);
      this.retryPending.delete(job.id);
      this.queue.unshift(job);
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
        log.warn(`Receipt print job for ${job.receipt.id} waiting — no printer configured`);
        this.queue.unshift(job);
        break;
      }

      try {
        await printReceipt(config.printerIp, job.receipt);
        this.recentPrints.set(this.dedupeKey(job.receipt.id), Date.now());
      } catch (error) {
        const message = error instanceof Error ? error.message : "Print failed";
        job.retryCount += 1;

        if (job.retryCount <= PRINT_RETRY_DELAYS_MS.length) {
          const delay =
            PRINT_RETRY_DELAYS_MS[job.retryCount - 1] ??
            PRINT_RETRY_DELAYS_MS[PRINT_RETRY_DELAYS_MS.length - 1];
          log.warn(
            `Receipt print failed for ${job.receipt.id} (${job.event}), retry ${job.retryCount}/${PRINT_RETRY_DELAYS_MS.length} in ${delay}ms`,
            error,
          );
          this.scheduleRetry(job, delay);
          continue;
        }

        log.error(
          `Failed to print receipt ${job.receipt.id} (${job.event}) after ${PRINT_RETRY_DELAYS_MS.length + 1} attempts`,
          error,
        );

        showTrayNotification(
          t("notifications.receiptFailed", { series: job.receipt.series, aa: job.receipt.aa }),
          formatFailureReason(message),
        );
        flashTrayIconRed();
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

export const receiptPrintQueue = new ReceiptPrintQueue();
