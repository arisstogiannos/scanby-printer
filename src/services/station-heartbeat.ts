import { hostname } from "node:os";
import { app } from "electron";
import log from "electron-log";
import { appState } from "@/services/app-state";
import { getConfig } from "@/services/config-store";
import { isSupabaseSubscribed, onSupabaseSubscriptionChange } from "@/services/supabase-listener";
import { getStationId } from "@/services/user-preferences";
import { STATION_HEARTBEAT_DEBOUNCE_MS, STATION_HEARTBEAT_INTERVAL_MS } from "@/shared/constants";

const REPORT_TIMEOUT_MS = 5_000;
const REMOVE_TIMEOUT_MS = 2_000;
/** A failure that repeats unchanged is logged again only after this long. */
const REPEATED_FAILURE_LOG_MS = 10 * 60 * 1000;

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let inFlight: AbortController | null = null;
let unsubscribers: Array<() => void> = [];
let stopped = true;
/**
 * What the last report carried, sent or not, so unrelated app-state churn sends
 * nothing — and a failing endpoint is retried by the tick, not by every change.
 */
let lastSentSignature: string | null = null;
let lastFailureKey: string | null = null;
let lastFailureLoggedAt = 0;

export function getStationName(): string {
  return hostname();
}

/**
 * Whether this build can check in with the server. `/status` reports it so the
 * dashboard stops vouching for the venue's printers on this station's behalf —
 * the two would otherwise overwrite each other's view of the same printers.
 */
export function isStationHeartbeatConfigured(): boolean {
  return Boolean(
    process.env.SCANBY_API_URL && process.env.PRINT_CLAIM_SECRET && getConfig()?.businessId,
  );
}

function stationsUrl(businessId: string): string | null {
  const apiUrl = process.env.SCANBY_API_URL?.replace(/\/$/, "");
  if (!apiUrl) {
    return null;
  }
  return `${apiUrl}/api/businesses/${encodeURIComponent(businessId)}/print-stations`;
}

function reportSignature(): string {
  return JSON.stringify({
    printers: appState.getSnapshot().printers,
    relaying: isSupabaseSubscribed(),
  });
}

/**
 * The server stamps `lastSeenAt` itself and treats silence as offline, so a
 * failed report needs no retry of its own — the next tick is the retry. This
 * only keeps a dead endpoint from writing the same line every 45 seconds.
 */
function logFailure(key: string, level: "error" | "warn", message: string, error?: unknown): void {
  const now = Date.now();
  if (key === lastFailureKey && now - lastFailureLoggedAt < REPEATED_FAILURE_LOG_MS) {
    return;
  }
  lastFailureKey = key;
  lastFailureLoggedAt = now;
  if (error === undefined) {
    log[level](message);
  } else {
    log[level](message, error);
  }
}

async function sendHeartbeat(): Promise<void> {
  const config = getConfig();
  const secret = process.env.PRINT_CLAIM_SECRET;
  const url = config ? stationsUrl(config.businessId) : null;
  if (stopped || !url || !secret) {
    return;
  }

  // One report at a time; a change that arrives meanwhile goes out after it.
  if (inFlight) {
    scheduleHeartbeat();
    return;
  }

  const snapshot = appState.getSnapshot();
  const controller = new AbortController();
  inFlight = controller;
  lastSentSignature = reportSignature();

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        stationId: getStationId(),
        kind: "desktop_agent",
        name: getStationName(),
        relaying: isSupabaseSubscribed(),
        // Reprints are claimed before printing, so the venue's phones need
        // not stand down while this station is live.
        claimsRelayJobs: true,
        appVersion: app.getVersion(),
        printers: snapshot.printers,
      }),
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(REPORT_TIMEOUT_MS)]),
    });

    if (response.status === 401 || response.status === 403) {
      logFailure(
        `http-${response.status}`,
        "error",
        `station-heartbeat auth failed (${response.status}) — check PRINT_CLAIM_SECRET`,
      );
      return;
    }

    if (!response.ok) {
      logFailure(
        `http-${response.status}`,
        "warn",
        `station-heartbeat rejected (${response.status}) — retrying on the next tick`,
      );
      return;
    }

    if (lastFailureKey !== null) {
      log.info("station-heartbeat recovered");
      lastFailureKey = null;
    }
  } catch (error) {
    if (controller.signal.aborted) {
      return;
    }
    logFailure("network", "warn", "station-heartbeat request failed", error);
  } finally {
    if (inFlight === controller) {
      inFlight = null;
    }
  }
}

/** Coalesces a burst of changes into one report instead of one per change. */
function scheduleHeartbeat(): void {
  if (stopped || debounceTimer) {
    return;
  }
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void sendHeartbeat();
  }, STATION_HEARTBEAT_DEBOUNCE_MS);
}

function handleStateChange(): void {
  if (reportSignature() !== lastSentSignature) {
    scheduleHeartbeat();
  }
}

/**
 * Starts checking in, or reports right away if already running — pairing calls
 * this so the venue sees the station without waiting for the next tick.
 */
export function startStationHeartbeat(): void {
  if (!isStationHeartbeatConfigured()) {
    log.info("Station heartbeat skipped — SCANBY_API_URL, PRINT_CLAIM_SECRET, or pairing not set");
    return;
  }

  if (stopped) {
    stopped = false;
    const onAppStateChange = () => handleStateChange();
    appState.on("change", onAppStateChange);
    unsubscribers = [
      () => appState.off("change", onAppStateChange),
      onSupabaseSubscriptionChange(handleStateChange),
    ];
    heartbeatTimer = setInterval(() => {
      void sendHeartbeat();
    }, STATION_HEARTBEAT_INTERVAL_MS);
    log.info(`Station heartbeat started (every ${STATION_HEARTBEAT_INTERVAL_MS / 1_000}s)`);
  }

  void sendHeartbeat();
}

export function stopStationHeartbeat(): void {
  stopped = true;
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  // A report still on the wire could land after the DELETE and bring the
  // station back as a ghost.
  inFlight?.abort();
  inFlight = null;
  for (const unsubscribe of unsubscribers) {
    unsubscribe();
  }
  unsubscribers = [];
  lastSentSignature = null;
  lastFailureKey = null;
}

/**
 * Tells the server this station is going away, so the venue does not see it
 * as a printer that went offline. Best-effort and bounded: the server ages a
 * silent station out on its own, so this must never hold up unpair or quit.
 *
 * Pass the business when it is no longer the paired one (re-pairing elsewhere).
 */
export async function removeStation(businessId = getConfig()?.businessId): Promise<void> {
  const secret = process.env.PRINT_CLAIM_SECRET;
  const url = businessId ? stationsUrl(businessId) : null;
  if (!url || !secret) {
    return;
  }

  try {
    const response = await fetch(url, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ stationId: getStationId() }),
      signal: AbortSignal.timeout(REMOVE_TIMEOUT_MS),
    });
    if (!response.ok) {
      log.info(`station-heartbeat remove rejected (${response.status})`);
    }
  } catch (error) {
    log.info("station-heartbeat remove failed", error);
  }
}
