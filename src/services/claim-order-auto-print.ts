import { callScanbyApi, isScanbyApiConfigured } from "@/services/scanby-api";
import { normalizePrintOrder } from "@/shared/print-payload";
import type { PrintOrder } from "@/shared/types";

type ClaimAutoPrintResponse = {
  claimed?: boolean;
  order?: unknown;
  /** `held`: another station holds a claim that may still lapse. */
  reason?: string;
};

export type ClaimAutoPrintResult =
  /** Ours to print. `order` is the server's copy, or null from a server too old to send one. */
  | { kind: "claimed"; order: PrintOrder | null }
  /** Printed, or taken for good by another station. */
  | { kind: "lost" }
  /** A tab or phone holds it for now; the sweep takes it if they let go. */
  | { kind: "held" }
  | { kind: "unavailable" }
  | { kind: "retry" };

/**
 * Whether this build can ask the server who owns a new order's ticket. Without
 * it the app must not auto-print at all: the dashboard claims the order and
 * sends it over the loopback API, and a second unclaimed copy of the same
 * ticket would come out of the same printer.
 */
export function isAutoPrintClaimConfigured(): boolean {
  return isScanbyApiConfigured();
}

/**
 * The claim is this station's alone and never lapses: the job is on disk and
 * survives a restart, so the ticket prints when the app comes back. Retrying
 * it is always safe — the server hands a station its own claim back.
 */
export async function claimOrderAutoPrint(orderId: string): Promise<ClaimAutoPrintResult> {
  const result = await callScanbyApi<ClaimAutoPrintResponse>(
    `/orders/${encodeURIComponent(orderId)}/claim-auto-print`,
    { method: "POST" },
  );

  if (result.kind === "retry" || result.kind === "unavailable") {
    return { kind: result.kind };
  }
  if (result.kind === "rejected") {
    return { kind: "lost" };
  }
  if (result.data.claimed === true) {
    return { kind: "claimed", order: normalizePrintOrder(result.data.order ?? null) };
  }
  return result.data.reason === "held" ? { kind: "held" } : { kind: "lost" };
}

/** Hands a claim back unprinted. Best-effort: the next sweep is the retry. */
export async function releaseOrderAutoPrint(orderId: string): Promise<void> {
  await callScanbyApi(`/orders/${encodeURIComponent(orderId)}/release-auto-print`, {
    method: "POST",
  });
}
