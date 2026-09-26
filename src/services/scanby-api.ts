import log from "electron-log";
import { getConfig } from "@/services/config-store";
import { getStationId } from "@/services/user-preferences";

const DEFAULT_TIMEOUT_MS = 5_000;
/** How recent a successful call must be for this station to vouch for its own claiming. */
const HEALTHY_WITHIN_MS = 2 * 60 * 1000;

let lastSuccessAt = 0;
let lastAuthFailureAt = 0;

export type ScanbyApiResult<T> =
  | { kind: "ok"; data: T }
  /** The network or the server failed; the same call may well work later. */
  | { kind: "retry" }
  /** The server understood and said no (4xx other than auth). */
  | { kind: "rejected"; status: number }
  /** This build cannot talk to the server: not configured, or the secret is wrong. */
  | { kind: "unavailable" };

/**
 * Whether this build can reach the Scanby API on the venue's behalf. Without
 * it the app neither claims nor sweeps, and behaves as older builds did.
 */
export function isScanbyApiConfigured(): boolean {
  return Boolean(
    process.env.SCANBY_API_URL && process.env.PRINT_CLAIM_SECRET && getConfig()?.businessId,
  );
}

/**
 * Whether this station is claiming and sweeping for real right now: configured,
 * and an authenticated call went through within the last two minutes. A wrong
 * secret or a server that bounces the calls must not have the dashboard on
 * this PC stand down for a station that is printing nothing.
 */
export function isScanbyApiHealthy(now = Date.now()): boolean {
  return (
    isScanbyApiConfigured() &&
    now - lastSuccessAt < HEALTHY_WITHIN_MS &&
    lastSuccessAt > lastAuthFailureAt
  );
}

/**
 * Calls `/api/businesses/:businessId{path}` with the service secret. Every
 * body carries this station's id: it is how the server hands this station its
 * own claim back when a retry follows a response the network ate.
 */
export async function callScanbyApi<T>(
  path: string,
  init: { method: "GET" | "POST"; body?: Record<string, unknown>; timeoutMs?: number },
): Promise<ScanbyApiResult<T>> {
  const apiUrl = process.env.SCANBY_API_URL?.replace(/\/$/, "");
  const secret = process.env.PRINT_CLAIM_SECRET;
  const businessId = getConfig()?.businessId;
  if (!apiUrl || !secret || !businessId) {
    return { kind: "unavailable" };
  }

  const url = `${apiUrl}/api/businesses/${encodeURIComponent(businessId)}${path}`;
  const body = init.method === "POST" ? { stationId: getStationId(), ...init.body } : undefined;

  try {
    const response = await fetch(url, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${secret}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      // A redirect is the server refusing the call without a session — never
      // a page to follow and parse.
      redirect: "manual",
      signal: AbortSignal.timeout(init.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });

    if (response.status >= 300 && response.status < 400) {
      log.warn(
        `${init.method} ${path} redirected (${response.status}) — not accepted by the server`,
      );
      return { kind: "retry" };
    }
    if (response.status === 401 || response.status === 403) {
      lastAuthFailureAt = Date.now();
      log.error(
        `${init.method} ${path} auth failed (${response.status}) — check PRINT_CLAIM_SECRET`,
      );
      return { kind: "unavailable" };
    }
    if (response.status >= 500) {
      log.warn(`${init.method} ${path} server error (${response.status})`);
      return { kind: "retry" };
    }
    if (!response.ok) {
      log.warn(`${init.method} ${path} rejected (${response.status})`);
      return { kind: "rejected", status: response.status };
    }
    const data = (await response.json()) as T;
    lastSuccessAt = Date.now();
    return { kind: "ok", data };
  } catch (error) {
    log.warn(`${init.method} ${path} request failed`, error);
    return { kind: "retry" };
  }
}
