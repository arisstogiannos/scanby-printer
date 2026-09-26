import { callScanbyApi } from "@/services/scanby-api";
import { normalizePrintOrder } from "@/shared/print-payload";
import { normalizePrintReceipt } from "@/shared/receipt-payload";
import type { PrintOrder, PrintReceipt } from "@/shared/types";

type ClaimRelayJobResponse = {
  claimed?: boolean;
  kind?: "order" | "receipt";
  order?: unknown;
  receipt?: unknown;
  reason?: string;
};

export type ClaimRelayJobResult =
  | { kind: "claimed"; order: PrintOrder | null; receipt: PrintReceipt | null }
  /** Printed by another station, or nothing left to print. */
  | { kind: "lost" }
  /** A phone holds it for now. */
  | { kind: "held" }
  | { kind: "retry" }
  /**
   * This build cannot claim at all. It then prints what it hears, as builds
   * before relay claims did — and says so in its check-in, so the venue's
   * phones stand down rather than print a second copy.
   */
  | { kind: "unclaimable" };

/** Hands a relay job back unprinted, so a station that can print it takes it. Best-effort. */
export async function releaseRelayJob(jobId: string): Promise<void> {
  await callScanbyApi(`/print-relay-jobs/${encodeURIComponent(jobId)}/release`, {
    method: "POST",
  });
}

/**
 * Claims a reprint someone asked for on a device without a printer. Like the
 * new-order claim it never lapses and retrying it is safe.
 */
export async function claimRelayJob(jobId: string): Promise<ClaimRelayJobResult> {
  const result = await callScanbyApi<ClaimRelayJobResponse>(
    `/print-relay-jobs/${encodeURIComponent(jobId)}/claim`,
    { method: "POST" },
  );

  if (result.kind === "retry") {
    return { kind: "retry" };
  }
  if (result.kind === "unavailable") {
    return { kind: "unclaimable" };
  }
  if (result.kind === "rejected") {
    // A server without the route never sends a job id; any other refusal of
    // the request itself means this job is not ours to print.
    return result.status === 404 ? { kind: "unclaimable" } : { kind: "lost" };
  }

  const data = result.data;
  if (data.claimed !== true) {
    return data.reason === "held" ? { kind: "held" } : { kind: "lost" };
  }
  return {
    kind: "claimed",
    order: data.kind === "order" ? normalizePrintOrder(data.order ?? null) : null,
    receipt: data.kind === "receipt" ? normalizePrintReceipt(data.receipt ?? null) : null,
  };
}
