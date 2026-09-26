import { join } from "node:path";
import { readJsonFile, writeJsonAtomic } from "@/services/json-file";
import { DELIVERED_LEDGER_RETENTION_MS } from "@/shared/constants";

/**
 * What this station has already taken responsibility for printing, kept on
 * disk across restarts.
 *
 * The server's claims decide which station prints a job; this is the second
 * line, for the rare path where the same job reaches this station twice —
 * the dashboard on this PC handing over a ticket this app then also finds in a
 * sweep, a broadcast and a sweep landing together, or a receipt heard both on
 * the channel and from the catch-up feed. Keys:
 *
 * - `order_created:<orderId>` — the new-order ticket, which prints once, ever.
 * - `relay:<jobId>` — a relayed reprint.
 * - `receipt:<receiptId>` — a receipt this station has seen, so the catch-up
 *   feed does not print one it already printed.
 */

type LedgerFile = {
  entries: Record<string, number>;
  /** The server time the receipt catch-up feed last read up to. */
  receiptWatermark?: string;
  receiptWatermarkSavedAt?: number;
};

let userDataPath = "";
let ledger: LedgerFile = { entries: {} };

function getLedgerPath(): string {
  return join(userDataPath, "delivered-prints.json");
}

function prune(now: number): void {
  for (const [key, at] of Object.entries(ledger.entries)) {
    if (!Number.isFinite(at) || now - at > DELIVERED_LEDGER_RETENTION_MS) {
      delete ledger.entries[key];
    }
  }
}

function save(): void {
  if (!userDataPath) {
    return;
  }
  writeJsonAtomic(getLedgerPath(), ledger);
}

export function initDeliveredLedger(dataPath: string): void {
  userDataPath = dataPath;
  ledger = { entries: {} };
  // A corrupt ledger costs at most a duplicate ticket; the claims still hold.
  const parsed = readJsonFile(getLedgerPath()) as Partial<LedgerFile> | null;
  if (parsed && typeof parsed.entries === "object" && parsed.entries !== null) {
    ledger = {
      entries: { ...parsed.entries },
      receiptWatermark:
        typeof parsed.receiptWatermark === "string" ? parsed.receiptWatermark : undefined,
      receiptWatermarkSavedAt:
        typeof parsed.receiptWatermarkSavedAt === "number"
          ? parsed.receiptWatermarkSavedAt
          : undefined,
    };
  }
  prune(Date.now());
}

export function hasDelivered(key: string): boolean {
  const at = ledger.entries[key];
  return at !== undefined && Date.now() - at <= DELIVERED_LEDGER_RETENTION_MS;
}

export function markDelivered(key: string): void {
  const now = Date.now();
  prune(now);
  ledger.entries[key] = now;
  save();
}

/** For a job dropped before it was ours, so a legitimate hand-over is not refused later. */
export function forgetDelivered(key: string): void {
  if (key in ledger.entries) {
    delete ledger.entries[key];
    save();
  }
}

/**
 * Where the receipt catch-up resumes, if it stopped recently enough that the
 * receipts since then were this station's to print — an app restart for an
 * update. After longer than that, it was not running, and in the connected
 * world it would not have printed them either.
 */
export function getReceiptWatermark(maxAgeMs: number): string | null {
  const savedAt = ledger.receiptWatermarkSavedAt;
  if (!ledger.receiptWatermark || savedAt === undefined || Date.now() - savedAt > maxAgeMs) {
    return null;
  }
  return ledger.receiptWatermark;
}

export function setReceiptWatermark(serverTime: string): void {
  ledger.receiptWatermark = serverTime;
  ledger.receiptWatermarkSavedAt = Date.now();
  save();
}

/** Unpair or a move to another venue: nothing here applies any more. */
export function clearDeliveredLedger(): void {
  ledger = { entries: {} };
  save();
}

export const deliveredKeys = {
  orderCreated: (orderId: string) => `order_created:${orderId}`,
  relayJob: (jobId: string) => `relay:${jobId}`,
  receipt: (receiptId: string) => `receipt:${receiptId}`,
};
