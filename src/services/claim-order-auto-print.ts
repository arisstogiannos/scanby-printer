import log from "electron-log";
import { getConfig } from "@/services/config-store";

const CLAIM_TIMEOUT_MS = 5_000;

type ClaimAutoPrintResponse = {
  claimed?: boolean;
  error?: string;
};

export type ClaimAutoPrintResult = "claimed" | "lost" | "unavailable" | "retry";

/**
 * Whether this build can ask the server who owns a new order's ticket. Without
 * it the app must not auto-print at all: the dashboard claims the order and
 * sends it over the loopback API, and a second unclaimed copy of the same
 * ticket would come out of the same printer.
 */
export function isAutoPrintClaimConfigured(): boolean {
  return Boolean(
    process.env.SCANBY_API_URL && process.env.PRINT_CLAIM_SECRET && getConfig()?.businessId,
  );
}

export async function claimOrderAutoPrint(orderId: string): Promise<ClaimAutoPrintResult> {
  const config = getConfig();
  const apiUrl = process.env.SCANBY_API_URL?.replace(/\/$/, "");
  const secret = process.env.PRINT_CLAIM_SECRET;

  if (!apiUrl || !secret || !config?.businessId) {
    log.warn(
      "claim-auto-print skipped: SCANBY_API_URL, PRINT_CLAIM_SECRET, or business pairing not configured — auto-print disabled to avoid duplicate tickets",
    );
    return "unavailable";
  }

  const url = `${apiUrl}/api/businesses/${encodeURIComponent(config.businessId)}/orders/${encodeURIComponent(orderId)}/claim-auto-print`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
      },
      signal: AbortSignal.timeout(CLAIM_TIMEOUT_MS),
    });

    if (response.status === 401 || response.status === 403) {
      log.error(`claim-auto-print auth failed (${response.status}) — check PRINT_CLAIM_SECRET`);
      return "unavailable";
    }

    if (response.status >= 500) {
      log.warn(`claim-auto-print server error (${response.status}) for order ${orderId}`);
      return "retry";
    }

    if (!response.ok) {
      log.warn(`claim-auto-print rejected (${response.status}) for order ${orderId}`);
      return "lost";
    }

    const data = (await response.json()) as ClaimAutoPrintResponse;
    return data.claimed === true ? "claimed" : "lost";
  } catch (error) {
    log.warn(`claim-auto-print request failed for order ${orderId}`, error);
    return "retry";
  }
}
