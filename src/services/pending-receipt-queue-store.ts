import { join } from "node:path";
import { readJsonFile, writeJsonAtomic } from "@/services/json-file";
import { normalizePrintReceipt } from "@/shared/receipt-payload";
import type { PrintHistorySource, PrintReceipt, ReceiptPrintEvent } from "@/shared/types";

export type PersistedReceiptJob = {
  id: string;
  receipt: PrintReceipt;
  event: ReceiptPrintEvent;
  source: PrintHistorySource;
  enqueuedAt: number;
  retryCount: number;
  targetPrinterId?: string;
  relayJobId?: string;
  claimAcquired?: boolean;
  noticeShown?: boolean;
  /** Waiting for a printer to be given a fiscal role, rather than retrying on a timer. */
  held?: boolean;
};

let userDataPath = "";

export function initPendingReceiptQueueStore(dataPath: string): void {
  userDataPath = dataPath;
}

function getQueuePath(): string {
  return join(userDataPath, "pending-receipt-queue.json");
}

/** Re-validates the document with the same parser the wire uses, so a stale file cannot print garbage. */
function toValidJob(value: unknown): PersistedReceiptJob | null {
  if (value === null || typeof value !== "object") {
    return null;
  }
  const o = value as Record<string, unknown>;
  const receipt = normalizePrintReceipt(o.receipt);
  if (
    !receipt ||
    typeof o.id !== "string" ||
    (o.event !== "receipt_created" && o.event !== "receipt_reprint") ||
    (o.source !== "realtime" && o.source !== "manual" && o.source !== "test") ||
    typeof o.enqueuedAt !== "number" ||
    typeof o.retryCount !== "number"
  ) {
    return null;
  }
  return {
    id: o.id,
    receipt,
    event: o.event,
    source: o.source,
    enqueuedAt: o.enqueuedAt,
    retryCount: o.retryCount,
    ...(typeof o.targetPrinterId === "string" ? { targetPrinterId: o.targetPrinterId } : {}),
    ...(typeof o.relayJobId === "string" ? { relayJobId: o.relayJobId } : {}),
    ...(o.claimAcquired === true ? { claimAcquired: true } : {}),
    ...(o.noticeShown === true ? { noticeShown: true } : {}),
    ...(o.held === true ? { held: true } : {}),
  };
}

export function loadPendingReceiptJobs(): PersistedReceiptJob[] {
  if (!userDataPath) {
    return [];
  }
  const parsed = readJsonFile(getQueuePath());
  return Array.isArray(parsed)
    ? parsed.map(toValidJob).filter((job): job is PersistedReceiptJob => job !== null)
    : [];
}

export function savePendingReceiptJobs(jobs: PersistedReceiptJob[]): void {
  if (!userDataPath) {
    return;
  }
  writeJsonAtomic(getQueuePath(), jobs);
}
