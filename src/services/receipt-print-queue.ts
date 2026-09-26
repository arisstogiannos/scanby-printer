import { randomUUID } from "node:crypto";
import log from "electron-log";
import { flashTrayIconRed } from "@/main/tray-effects";
import { appState } from "@/services/app-state";
import { canPrintDocument } from "@/services/can-print-document";
import { claimRelayJob, releaseRelayJob } from "@/services/claim-relay-job";
import { getConfig } from "@/services/config-store";
import {
  deliveredKeys,
  forgetDelivered,
  hasDelivered,
  markDelivered,
} from "@/services/delivered-ledger";
import {
  loadPendingReceiptJobs,
  type PersistedReceiptJob,
  savePendingReceiptJobs,
} from "@/services/pending-receipt-queue-store";
import { findPrinterById, getRoutablePrinters } from "@/services/printer-registry";
import { printReceipt } from "@/services/printer-service";
import { showTrayNotification } from "@/services/tray-notifications";
import {
  AUTO_PRINT_MAX_AGE_MS,
  PENDING_JOB_MAX_AGE_MS,
  PRINT_DEDUPE_MS,
  PRINT_RETRY_DELAYS_MS,
  PRINT_RETRY_NOTICE_AFTER,
} from "@/shared/constants";
import { t } from "@/shared/i18n";
import { selectPrintTargets } from "@/shared/printer-routing";
import type {
  PrintDocumentClass,
  PrintHistorySource,
  PrintReceipt,
  ReceiptPrintEvent,
  RegisteredPrinter,
} from "@/shared/types";

type ReceiptQueueJob = PersistedReceiptJob;

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

function retryDelayMs(retryCount: number): number {
  const index = Math.min(Math.max(retryCount, 1), PRINT_RETRY_DELAYS_MS.length) - 1;
  return PRINT_RETRY_DELAYS_MS[index];
}

/**
 * A late receipt is a wasted slip of paper, never a second meal cooked, so
 * every receipt is retried as long as an automatic ticket is — a reprint
 * included. One waiting for a fiscal role is held for up to a day.
 */
function maxAgeFor(job: ReceiptQueueJob): number {
  return job.held ? PENDING_JOB_MAX_AGE_MS : AUTO_PRINT_MAX_AGE_MS;
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

/**
 * Signed documents waiting for this station's fiscal printers, on disk so a
 * restart loses none. Retried until they print or grow too old; a document
 * with no printer allowed to take it is held until one is.
 */
class ReceiptPrintQueue {
  private queue: ReceiptQueueJob[] = [];
  private retryPending = new Map<string, ReceiptQueueJob>();
  private retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private processing = false;
  private restored = false;
  private recentPrints = new Map<string, number>();
  /**
   * Signed documents with no printer allowed to render them.
   *
   * Held rather than retried on a timer: backing off would accomplish nothing —
   * no amount of waiting assigns a role. They come back the moment the
   * registry changes, so assigning a fiscal role in settings is all it takes
   * for the waiting receipts to print.
   */
  private heldJobs: ReceiptQueueJob[] = [];
  /** The document being claimed or printed right now; see the order queue's `current`. */
  private current: ReceiptQueueJob | null = null;

  private persistQueue(): void {
    savePendingReceiptJobs([
      ...(this.current ? [this.current] : []),
      ...this.queue,
      ...this.retryPending.values(),
      ...this.heldJobs,
    ]);
  }

  private findPending(predicate: (job: ReceiptQueueJob) => boolean): ReceiptQueueJob | undefined {
    if (this.current && predicate(this.current)) {
      return this.current;
    }
    return (
      this.queue.find(predicate) ??
      [...this.retryPending.values()].find(predicate) ??
      this.heldJobs.find(predicate)
    );
  }

  /** Whether this station has seen this receipt, queued or printed. */
  hasReceipt(receiptId: string): boolean {
    return (
      hasDelivered(deliveredKeys.receipt(receiptId)) ||
      this.findPending((job) => job.receipt.id === receiptId) !== undefined
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
    this.heldJobs = [];
    this.current = null;
    this.processing = false;
    this.restored = false;
    savePendingReceiptJobs([]);
  }

  restorePendingJobs(): void {
    if (this.restored) {
      return;
    }
    this.restored = true;

    const now = Date.now();
    for (const job of loadPendingReceiptJobs()) {
      if (now - job.enqueuedAt > maxAgeFor(job)) {
        log.warn(`Receipt ${job.receipt.id} expired while the app was closed`);
        continue;
      }
      if (job.held) {
        this.heldJobs.push(job);
        appState.recordUnroutableFiscalDocument();
      } else {
        this.queue.push(job);
      }
    }
    this.persistQueue();

    if (this.queue.length > 0 || this.heldJobs.length > 0) {
      log.info(
        `Restored ${this.queue.length} pending and ${this.heldJobs.length} held receipt(s) from disk`,
      );
      void this.processQueue();
    }
  }

  /** Called when the registry changes — a new role may have unblocked these. */
  retryHeldJobs(): void {
    if (this.heldJobs.length === 0) {
      return;
    }
    log.info(`Retrying ${this.heldJobs.length} receipt(s) held with no fiscal printer`);
    for (const job of this.heldJobs) {
      job.held = false;
    }
    this.queue.unshift(...this.heldJobs);
    this.heldJobs = [];
    this.persistQueue();
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
      /** The relay job this reprint is stored as; claimed before printing unless pre-claimed. */
      relayJobId?: string;
      preClaimed?: boolean;
    } = {},
  ): boolean {
    const source = options.source ?? "realtime";
    const event = options.event ?? "receipt_created";
    const now = Date.now();

    // The automatic copy prints once per station however it arrives — the
    // channel, the catch-up feed, or the dashboard on this PC.
    if (event === "receipt_created" && hasDelivered(deliveredKeys.receipt(receipt.id))) {
      log.info(`Skipping receipt ${receipt.id} — already printed here`);
      return false;
    }

    // Two copies of the same document queued at once — the broadcast and the
    // dashboard's hand-over, typically — print once. A relayed reprint is not a
    // copy of anything: someone asked for it, so it prints regardless.
    const pending = options.relayJobId
      ? undefined
      : this.findPending((job) => job.receipt.id === receipt.id);
    if (pending) {
      if (options.targetPrinterId && pending.targetPrinterId !== options.targetPrinterId) {
        // An operator chose where this one prints — often precisely because
        // the copy already here is held with no fiscal printer. Send that
        // copy there rather than ignore the choice.
        this.redirect(pending, options.targetPrinterId);
        return true;
      }
      log.info(`Skipping receipt ${receipt.id} (${event}) — already queued`);
      return false;
    }

    const lastPrinted = this.recentPrints.get(receipt.id);
    if (!options.relayJobId && lastPrinted !== undefined && now - lastPrinted < PRINT_DEDUPE_MS) {
      log.info(`Skipping duplicate receipt print for ${receipt.id} (${event})`);
      return false;
    }

    if (options.relayJobId && this.hasRelayJob(options.relayJobId)) {
      log.info(`Skipping relay job ${options.relayJobId} — already taken by this station`);
      return false;
    }

    const job: ReceiptQueueJob = {
      id: randomUUID(),
      receipt,
      event,
      source,
      enqueuedAt: now,
      retryCount: 0,
      ...(options.targetPrinterId ? { targetPrinterId: options.targetPrinterId } : {}),
      ...(options.relayJobId ? { relayJobId: options.relayJobId } : {}),
      ...(options.preClaimed || !options.relayJobId ? { claimAcquired: true } : {}),
    };

    markDelivered(deliveredKeys.receipt(receipt.id));
    if (options.relayJobId && options.preClaimed) {
      markDelivered(deliveredKeys.relayJob(options.relayJobId));
    }

    this.queue.push(job);
    this.persistQueue();
    void this.processQueue();
    return true;
  }

  private redirect(job: ReceiptQueueJob, targetPrinterId: string): void {
    log.info(`Receipt ${job.receipt.id} redirected to printer ${targetPrinterId} by an operator`);
    job.targetPrinterId = targetPrinterId;
    const heldIndex = this.heldJobs.indexOf(job);
    if (heldIndex !== -1) {
      this.heldJobs.splice(heldIndex, 1);
      job.held = false;
      this.queue.unshift(job);
    }
    this.persistQueue();
    void this.processQueue();
  }

  /** The job is no longer in flight — done, dropped, held or waiting on a timer. Call before persisting. */
  private settle(job: ReceiptQueueJob): void {
    if (this.current === job) {
      this.current = null;
    }
  }

  private scheduleRetry(job: ReceiptQueueJob, delayMs: number): void {
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

  private giveUp(job: ReceiptQueueJob, message: string): void {
    this.settle(job);
    log.error(
      `Giving up on receipt ${job.receipt.id} (${job.event}) after ${job.retryCount} retries: ${message}`,
    );
    this.persistQueue();
    showTrayNotification(
      t("notifications.receiptFailed", { series: job.receipt.series, aa: job.receipt.aa }),
      formatFailureReason(message),
    );
    flashTrayIconRed();
  }

  private retryOrGiveUp(job: ReceiptQueueJob, message: string): void {
    job.retryCount += 1;
    const delay = retryDelayMs(job.retryCount);
    if (Date.now() + delay - job.enqueuedAt > maxAgeFor(job)) {
      this.giveUp(job, message);
      return;
    }
    log.warn(
      `Receipt ${job.receipt.id} (${job.event}) not printed yet (${message}) — retry ${job.retryCount} in ${delay}ms`,
    );
    this.scheduleRetry(job, delay);
  }

  /** Resolves true when the reprint is now this station's to print. */
  private async acquireRelayClaim(job: ReceiptQueueJob, relayJobId: string): Promise<boolean> {
    // This station's claims never lapse, so it must not take a document it
    // has no printer for: a phone with a fiscal printer could print it.
    if (!job.targetPrinterId && !canPrintDocument(documentClassOf(job.receipt))) {
      log.info(`Leaving relayed receipt ${job.receipt.id} — no printer here may print it`);
      forgetDelivered(deliveredKeys.relayJob(relayJobId));
      this.settle(job);
      this.persistQueue();
      return false;
    }

    const result = await claimRelayJob(relayJobId);
    switch (result.kind) {
      case "claimed":
        if (result.receipt) job.receipt = result.receipt;
        markDelivered(deliveredKeys.relayJob(relayJobId));
        return true;
      case "unclaimable":
        // Now an ordinary print, as builds before relay claims made it.
        log.warn(`Relay job ${relayJobId} cannot be claimed — printing it as before`);
        job.relayJobId = undefined;
        return true;
      case "retry":
        this.retryOrGiveUp(job, "Reprint claim failed");
        return false;
      case "held":
      case "lost":
        log.info(`Skipping receipt ${job.receipt.id} — another station took the reprint`);
        forgetDelivered(deliveredKeys.relayJob(relayJobId));
        this.settle(job);
        this.persistQueue();
        return false;
    }
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
      this.current = null;
      const job = this.queue.shift();
      if (!job) {
        break;
      }

      const config = getConfig();
      const hasSomewhereToPrint = Boolean(config?.printerIp) || getRoutablePrinters().length > 0;
      if (!hasSomewhereToPrint) {
        log.warn(`Receipt print job for ${job.receipt.id} waiting — no printer configured`);
        this.queue.unshift(job);
        this.persistQueue();
        break;
      }
      this.current = job;

      if (Date.now() - job.enqueuedAt > maxAgeFor(job)) {
        this.giveUp(job, "Print job expired");
        continue;
      }

      if (job.relayJobId && !job.claimAcquired) {
        if (!(await this.acquireRelayClaim(job, job.relayJobId))) {
          continue;
        }
        job.claimAcquired = true;
        this.persistQueue();
      }

      try {
        await this.printOnEveryTarget(job);
        this.recentPrints.set(job.receipt.id, Date.now());
        appState.clearUnroutableFiscalDocuments();
        this.settle(job);
        this.persistQueue();
        if (job.noticeShown) {
          showTrayNotification(
            t("notifications.receiptPrintedAfterRetry", {
              series: job.receipt.series,
              aa: job.receipt.aa,
            }),
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Print failed";

        if (error instanceof NoFiscalPrinterError && job.relayJobId) {
          // Claimed while a fiscal printer was there, and it has gone since.
          // Hand the reprint back rather than hold it where it cannot print.
          log.warn(
            `Relayed receipt ${job.receipt.id} has no fiscal printer here — handing it back`,
          );
          const relayJobId = job.relayJobId;
          forgetDelivered(deliveredKeys.relayJob(relayJobId));
          this.settle(job);
          this.persistQueue();
          void releaseRelayJob(relayJobId);
          continue;
        }

        if (error instanceof NoFiscalPrinterError) {
          // A backoff would accomplish nothing — no amount of waiting assigns
          // a role — and expiring the job would discard a legal document. Hold
          // it, alert, and let `retryHeldJobs` release it when a role appears.
          job.held = true;
          this.settle(job);
          this.heldJobs.push(job);
          this.persistQueue();
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

        if (!job.noticeShown && job.retryCount + 1 >= PRINT_RETRY_NOTICE_AFTER) {
          job.noticeShown = true;
          showTrayNotification(
            t("notifications.receiptWaiting", { series: job.receipt.series, aa: job.receipt.aa }),
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
