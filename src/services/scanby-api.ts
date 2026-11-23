import log from "electron-log";
import { getConfig } from "@/services/config-store";
import {
  hasScanbyAuth,
  reportScanbyAuthAccepted,
  reportScanbyAuthRejected,
  resolveScanbyAuth,
  resolveStationAuth,
} from "@/services/scanby-auth";
import { getStationId } from "@/services/user-preferences";
import type { ScanbyAuth } from "@/shared/station-credential";

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
  /** This build cannot talk to the server: not configured, or no credential it accepts. */
  | { kind: "unavailable" };

type CallInit = {
  method: "GET" | "POST";
  body?: Record<string, unknown>;
  timeoutMs?: number;
  /** Only this station's own credential: no shared-secret fallback. */
  stationOnly?: boolean;
};

/**
 * Whether this build can reach the Scanby API on the venue's behalf: its own
 * station credential, or the shared secret of builds before credentials.
 * Without either the app neither claims nor sweeps, as older builds did.
 */
export function isScanbyApiConfigured(): boolean {
  return Boolean(process.env.SCANBY_API_URL && hasScanbyAuth() && getConfig()?.businessId);
}

/**
 * Whether this station is claiming and sweeping for real right now: configured,
 * and an authenticated call went through within the last two minutes. A
 * refused credential or a server that bounces the calls must not have the
 * dashboard on this PC stand down for a station that is printing nothing.
 */
export function isScanbyApiHealthy(now = Date.now()): boolean {
  return (
    isScanbyApiConfigured() &&
    now - lastSuccessAt < HEALTHY_WITHIN_MS &&
    lastSuccessAt > lastAuthFailureAt
  );
}

async function send<T>(
  url: string,
  path: string,
  init: CallInit,
  auth: ScanbyAuth,
): Promise<ScanbyApiResult<T> | "auth_failed"> {
  const body = init.method === "POST" ? { stationId: getStationId(), ...init.body } : undefined;

  try {
    const response = await fetch(url, {
      method: init.method,
      headers: {
        Authorization: auth.authorization,
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
        `${init.method} ${path} auth failed (${response.status}) with the ${auth.kind === "station" ? "station credential" : "shared secret"}`,
      );
      reportScanbyAuthRejected(auth.kind);
      return "auth_failed";
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
    reportScanbyAuthAccepted(auth.kind);
    return { kind: "ok", data };
  } catch (error) {
    log.warn(`${init.method} ${path} request failed`, error);
    return { kind: "retry" };
  }
}

/**
 * Calls `/api/businesses/:businessId{path}` with this station's credential, or
 * the shared secret of older builds. A refused credential is retried once with
 * the secret, so the call is not lost while the server still accepts it. Every
 * body carries this station's id: it is how the server hands a shared-secret
 * station its own claim back when a retry follows a response the network ate.
 */
export async function callScanbyApi<T>(path: string, init: CallInit): Promise<ScanbyApiResult<T>> {
  const apiUrl = process.env.SCANBY_API_URL?.replace(/\/$/, "");
  const businessId = getConfig()?.businessId;
  const auth = init.stationOnly ? resolveStationAuth() : resolveScanbyAuth();
  if (!apiUrl || !auth || !businessId) {
    return { kind: "unavailable" };
  }

  const url = `${apiUrl}/api/businesses/${encodeURIComponent(businessId)}${path}`;
  const result = await send<T>(url, path, init, auth);
  if (result !== "auth_failed") {
    return result;
  }

  const fallback = init.stationOnly ? null : resolveScanbyAuth();
  if (auth.kind !== "station" || fallback?.kind !== "secret") {
    return { kind: "unavailable" };
  }
  const retried = await send<T>(url, path, init, fallback);
  return retried === "auth_failed" ? { kind: "unavailable" } : retried;
}
