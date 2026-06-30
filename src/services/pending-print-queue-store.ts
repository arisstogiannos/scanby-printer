import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { OrderPrintEvent, PrintHistorySource, PrintOrder } from "@/shared/types";

export type PersistedQueueJob = {
  id: string;
  order: PrintOrder;
  event: OrderPrintEvent;
  source: PrintHistorySource;
  historyEntryId: string | null;
  enqueuedAt: number;
  retryCount: number;
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
    (o.event === "order_created" || o.event === "order_updated" || o.event === "order_cancelled") &&
    (o.source === "realtime" || o.source === "manual" || o.source === "test") &&
    (o.historyEntryId === null || typeof o.historyEntryId === "string") &&
    typeof o.enqueuedAt === "number" &&
    typeof o.retryCount === "number"
  );
}

export function loadPendingJobs(): PersistedQueueJob[] {
  if (!userDataPath) {
    return [];
  }

  const queuePath = getQueuePath();
  if (!existsSync(queuePath)) {
    return [];
  }

  try {
    const raw = readFileSync(queuePath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isValidJob);
  } catch {
    return [];
  }
}

export function savePendingJobs(jobs: PersistedQueueJob[]): void {
  if (!userDataPath) {
    return;
  }

  if (!existsSync(userDataPath)) {
    mkdirSync(userDataPath, { recursive: true });
  }

  writeFileSync(getQueuePath(), JSON.stringify(jobs, null, 2), "utf-8");
}
