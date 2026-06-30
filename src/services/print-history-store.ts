import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getConfig } from "@/services/config-store";
import type {
  PrintHistoryEntry,
  PrintHistorySource,
  PrintHistoryStatus,
  PrintOrder,
} from "@/shared/types";

const MAX_ENTRIES = 10;

let userDataPath = "";
let entries: PrintHistoryEntry[] = [];
const changeListeners = new Set<() => void>();

function emitChange(): void {
  for (const listener of changeListeners) {
    listener();
  }
}

export function onPrintHistoryChange(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
}

type RecordPrintParams = {
  orderId: string;
  orderNumber: number;
  table: string;
  source: PrintHistorySource;
  status: PrintHistoryStatus;
  payload?: PrintOrder;
  error?: string;
};

export function initPrintHistoryStore(dataPath: string): void {
  userDataPath = dataPath;
  entries = loadFromDisk();
}

function getHistoryPath(): string {
  return join(userDataPath, "print-history.json");
}

function isValidPrintOrder(value: unknown): value is PrintOrder {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const o = value as Record<string, unknown>;
  if (
    typeof o.id !== "string" ||
    typeof o.number !== "number" ||
    typeof o.table !== "string" ||
    typeof o.createdAt !== "string" ||
    !Array.isArray(o.items)
  ) {
    return false;
  }
  return o.items.every((item) => {
    if (item === null || typeof item !== "object") {
      return false;
    }
    const i = item as Record<string, unknown>;
    return (
      typeof i.quantity === "number" &&
      Number.isFinite(i.quantity) &&
      i.quantity > 0 &&
      typeof i.name === "string" &&
      (i.notes === undefined || typeof i.notes === "string") &&
      (i.price === undefined ||
        (typeof i.price === "number" && Number.isInteger(i.price) && i.price >= 0))
    );
  });
}

function isValidEntry(value: unknown): value is PrintHistoryEntry {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const o = value as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.businessId === "string" &&
    typeof o.orderId === "string" &&
    typeof o.orderNumber === "number" &&
    typeof o.table === "string" &&
    typeof o.printedAt === "string" &&
    (o.source === "realtime" || o.source === "manual" || o.source === "test") &&
    (o.status === "received" ||
      o.status === "printed" ||
      o.status === "failed" ||
      o.status === "success") &&
    (o.payload === undefined || isValidPrintOrder(o.payload)) &&
    (o.error === undefined || typeof o.error === "string")
  );
}

function loadFromDisk(): PrintHistoryEntry[] {
  if (!userDataPath) {
    return [];
  }

  const historyPath = getHistoryPath();
  if (!existsSync(historyPath)) {
    return [];
  }

  try {
    const raw = readFileSync(historyPath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isValidEntry).map(normalizeEntry);
  } catch {
    return [];
  }
}

function saveToDisk(): void {
  if (!userDataPath) {
    return;
  }

  if (!existsSync(userDataPath)) {
    mkdirSync(userDataPath, { recursive: true });
  }

  writeFileSync(getHistoryPath(), JSON.stringify(entries, null, 2), "utf-8");
}

function normalizeEntry(entry: PrintHistoryEntry): PrintHistoryEntry {
  if ((entry.status as string) === "success") {
    return { ...entry, status: "printed" };
  }
  return entry;
}

export function updatePrintStatus(
  entryId: string,
  status: PrintHistoryStatus,
  error?: string,
): PrintHistoryEntry | null {
  const entry = entries.find((item) => item.id === entryId);
  if (!entry) {
    return null;
  }

  entry.status = status;
  if (error) {
    entry.error = error;
  } else {
    delete entry.error;
  }

  saveToDisk();
  emitChange();
  return entry;
}

export function recordPrint(params: RecordPrintParams): PrintHistoryEntry {
  const businessId = getConfig()?.businessId ?? "";
  const entry: PrintHistoryEntry = {
    id: randomUUID(),
    businessId,
    ...params,
    printedAt: new Date().toISOString(),
  };

  entries.unshift(entry);
  if (entries.length > MAX_ENTRIES) {
    entries = entries.slice(0, MAX_ENTRIES);
  }

  saveToDisk();
  emitChange();
  return entry;
}

export function findEntryById(entryId: string): PrintHistoryEntry | null {
  return entries.find((entry) => entry.id === entryId) ?? null;
}

export function findLatestOrderById(orderId: string): PrintOrder | null {
  for (const entry of entries) {
    if (entry.orderId === orderId && entry.payload) {
      return entry.payload;
    }
  }
  return null;
}

export function findLatestEntryByOrderId(orderId: string): PrintHistoryEntry | null {
  return entries.find((entry) => entry.orderId === orderId) ?? null;
}

export function getPrintHistory(businessId?: string): PrintHistoryEntry[] {
  const bid = businessId ?? getConfig()?.businessId;
  if (!bid) {
    return [];
  }
  return entries.filter((entry) => entry.businessId === bid).slice(0, MAX_ENTRIES);
}

export function retainHistoryForBusiness(businessId: string): void {
  const before = entries.length;
  entries = entries.filter((entry) => entry.businessId === businessId);
  if (entries.length !== before) {
    saveToDisk();
    emitChange();
  }
}

export function clearPrintHistory(): void {
  entries = [];
  if (!userDataPath) {
    return;
  }

  const historyPath = getHistoryPath();
  if (existsSync(historyPath)) {
    unlinkSync(historyPath);
  }
  emitChange();
}
