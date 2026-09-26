import { randomUUID } from "node:crypto";
import log from "electron-log";
import { flashTrayIconRed } from "@/main/tray-effects";
import { appState } from "@/services/app-state";
import { getConfig } from "@/services/config-store";
import { findPrinterById, getRoutablePrinters } from "@/services/printer-registry";
import { printReceipt } from "@/services/printer-service";
import { showTrayNotification } from "@/services/tray-notifications";
import { PRINT_DEDUPE_MS, PRINT_RETRY_DELAYS_MS } from "@/shared/constants";
import { t } from "@/shared/i18n";
import { selectPrintTargets } from "@/shared/printer-routing";
import type {
  PrintDocumentClass,
  PrintHistorySource,
  PrintReceipt,
  ReceiptPrintEvent,
  RegisteredPrinter,
} from "@/shared/types";

type ReceiptQueueJob = {
  id: string;
  receipt: PrintReceipt;
  event: ReceiptPrintEvent;
  source: PrintHistorySource;
  enqueuedAt: number;
  retryCount: number;
  /**
   * A single printer a person explicitly chose, overriding role routing. Set
   * only from the dashboard's "print here just this once" — never by the
   * automatic path, which may not put a legal document on a kitchen roll.
   */
  targetPrinterId?: string;
};

/** Raised when a signed document has no printer allowed to render it. */
class NoFiscalPrinterError extends Error {
  constructor() {
    super("No printer is set to print receipts");
    this.name = "NoFiscalPrinterError";
  }
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
 * An unlabelled payload is treated as a receipt — the stricter of the two
 * classes — so a document from an older app build can never route as anything
 * a kitchen printer would accept.
 */
function documentClassOf(receipt: PrintReceipt): PrintDocumentClass {
  return receipt.documentClass === "order_slip" ? "order_slip" : "fiscal_receipt";
}

/**
 * Where a signed document may print.
 *
 * This is where "never reroute" lives. If no printer holds a fiscal role, the
 * job raises rather than falling back to whatever is plugged in: a receipt
 * coming out of the kitchen printer is how a guest ends up holding a ticket
 * that looks official and is not. The operator can still override it by hand
 * from the dashboard — a person deciding is a different thing from the queue
 * deciding for them.
 */
function resolveTargets(job: ReceiptQueueJob): RegisteredPrinter[] {
  const printers = getRoutablePrinters();

  if (job.targetPrinterId) {
    const chosen = findPrinterById(job.targetPrinterId);
    if (chosen) {
      log.info(
        `Receipt ${job.receipt.id} printing on "${chosen.name}" by operator override (role ${chosen.role})`,
      );
      return [chosen];
    }
    log.warn(`Receipt ${job.receipt.id}: overridden printer ${job.targetPrinterId} is unknown`);
  }

  const targets = selectPrintTargets(printers, documentClassOf(job.receipt));
  if (targets.length > 0) {
    return targets;
  }

  // Pre-roles fallback: an agent with no registry at all keeps printing on the
  // printer it was set up with, exactly as it did before roles existed.
  const config = getConfig();
  if (printers.length === 0 && config?.printerIp) {
    return [
      {
        id: `legacy:${config.printerIp}`,
        name: config.printerIp,
        role: "ALL",
        transport: "LAN",
        address: config.printerIp,
        enabled: true,
      },
    ];
  }

  throw new NoFiscalPrinterError();
}

class ReceiptPrintQueue {
  private queue: ReceiptQueueJob[] = [];
  private retryPending = new Map<string, ReceiptQueueJob>();
  private retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private processing = false;
  private recentPrints = new Map<string, number>();
  /**
   * Signed documents with no printer allowed to render them.
   *
   * Held rather than retried on a timer, and never expired: backing off would
   * accomplish nothing — no amount of waiting assigns a role — and giving up
   * would quietly discard a legal document. They come back the moment the
   * registry changes, so assigning a fiscal role in settings is all it takes
   * for the waiting receipts to print.
   */
  private heldJobs: ReceiptQueueJob[] = [];

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
    this.heldJobs = [];
    this.processing = false;
  }

  /** Called when the registry changes — a new role may have unblocked these. */
  retryHeldJobs(): void {
    if (this.heldJobs.length === 0) {
      return;
    }
    log.info(`Retrying ${this.heldJobs.length} receipt(s) held with no fiscal printer`);
    this.queue.unshift(...this.heldJobs);
    this.heldJobs = [];
    void this.processQueue();
  }

  countHeldJobs(): number {
    return this.heldJobs.length;
  }

  enqueue(
    receipt: PrintReceipt,
    options: {
      source?: PrintHistorySource;
      event?: ReceiptPrintEvent;
      targetPrinterId?: string;
    } = {},
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
      ...(options.targetPrinterId ? { targetPrinterId: options.targetPrinterId } : {}),
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

  /**
   * Fans a document out to every fiscal printer. Succeeds if any of them took
   * it; retries only when all of them refused, so one jammed till does not
   * replay a receipt onto the one that already printed it.
   */
  private async printOnEveryTarget(job: ReceiptQueueJob): Promise<void> {
    const targets = resolveTargets(job);

    const results = await Promise.allSettled(
      targets.map((target) => printReceipt(target.address, job.receipt, target.id)),
    );
    const failures = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );

    if (failures.length < results.length) {
      for (const failure of failures) {
        log.warn(`Receipt ${job.receipt.id} failed on one printer`, failure.reason);
      }
      return;
    }

    throw failures[0]?.reason instanceof Error
      ? failures[0].reason
      : new Error("Receipt failed on every printer");
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
      const hasSomewhereToPrint = Boolean(config?.printerIp) || getRoutablePrinters().length > 0;
      if (!hasSomewhereToPrint) {
        log.warn(`Receipt print job for ${job.receipt.id} waiting — no printer configured`);
        this.queue.unshift(job);
        break;
      }

      try {
        await this.printOnEveryTarget(job);
        this.recentPrints.set(this.dedupeKey(job.receipt.id), Date.now());
        appState.clearUnroutableFiscalDocuments();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Print failed";
        const isUnroutable = error instanceof NoFiscalPrinterError;

        if (isUnroutable) {
          // A backoff would accomplish nothing — no amount of waiting assigns
          // a role — and expiring the job would discard a legal document. Hold
          // it, alert, and let `retryHeldJobs` release it when a role appears.
          this.heldJobs.push(job);
          appState.recordUnroutableFiscalDocument();
          showTrayNotification(
            t("notifications.receiptNoFiscalPrinter", {
              series: job.receipt.series,
              aa: job.receipt.aa,
            }),
            t("notifications.receiptNoFiscalPrinterBody"),
          );
          flashTrayIconRed();
          continue;
        }

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
