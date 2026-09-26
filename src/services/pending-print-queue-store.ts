import { join } from "node:path";
import { readJsonFile, writeJsonAtomic } from "@/services/json-file";
import type { OrderPrintEvent, PrintHistorySource, PrintOrder } from "@/shared/types";

export type PersistedQueueJob = {
  id: string;
  order: PrintOrder;
  event: OrderPrintEvent;
  source: PrintHistorySource;
  historyEntryId: string | null;
  enqueuedAt: number;
  retryCount: number;
  claimAcquired?: boolean;
  /** The relay job a reprint was stored as, claimed before it prints. */
  relayJobId?: string;
  /** The tray already said this job is waiting; say so once, not per retry. */
  noticeShown?: boolean;
};

let userDataPath = "";

export function initPendingPrintQueueStore(dataPath: string): void {
  userDataPath = dataPath;
}

function getQueuePath(): string {
  return join(userDataPath, "pending-print-queue.json");
}

function isValidPrintOrder(value: unknown): value is PrintOrder {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const o = value as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.number === "number" &&
    typeof o.table === "string" &&
    typeof o.createdAt === "string" &&
    Array.isArray(o.items)
  );
}

function isValidJob(value: unknown): value is PersistedQueueJob {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const o = value as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    isValidPrintOrder(o.order) &&
    (o.event === "order_created" ||
      o.event === "order_updated" ||
      o.event === "order_cancelled" ||
      o.event === "order_reprint") &&
    (o.source === "realtime" || o.source === "manual" || o.source === "test") &&
    (o.historyEntryId === null || typeof o.historyEntryId === "string") &&
    typeof o.enqueuedAt === "number" &&
    typeof o.retryCount === "number" &&
    (o.claimAcquired === undefined || typeof o.claimAcquired === "boolean") &&
    (o.relayJobId === undefined || typeof o.relayJobId === "string") &&
    (o.noticeShown === undefined || typeof o.noticeShown === "boolean")
  );
}

export function loadPendingJobs(): PersistedQueueJob[] {
  if (!userDataPath) {
    return [];
  }

  const parsed = readJsonFile(getQueuePath());
  return Array.isArray(parsed) ? parsed.filter(isValidJob) : [];
}

export function savePendingJobs(jobs: PersistedQueueJob[]): void {
  if (!userDataPath) {
    return;
  }

  writeJsonAtomic(getQueuePath(), jobs);
}
