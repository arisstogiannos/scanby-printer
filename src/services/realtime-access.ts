import log from "electron-log";
import { getConfig, saveRealtimeMode } from "@/services/config-store";
import { callScanbyApi } from "@/services/scanby-api";
import {
  nextRealtimeCheckDelay,
  parseRealtimeAccess,
  REALTIME_MODE_POLL_MS,
  type RealtimeAccess,
} from "@/shared/realtime-access";

/**
 * How the listener joins the venue's channel:
 * - `public`: with the publishable key, exactly as builds before did;
 * - `private`: with a short-lived token the server signed for this business;
 * - `private-unauthorized`: the channel is private and this station has no
 *   token (no credential yet, or the server cannot sign one). It does not
 *   join, and the print sweeps carry the venue until it can.
 */
export type ListenPlan =
  | { mode: "public" }
  | { mode: "private"; token: string; expiresAt: number }
  | { mode: "private-unauthorized" };

/** A failed refresh keeps the current token and asks again this soon. */
const REFRESH_RETRY_MS = 60_000;

let checkTimer: ReturnType<typeof setTimeout> | null = null;
/** Bumped on every stop, so an answer that lands after it changes nothing. */
let generation = 0;

function toPlan(access: RealtimeAccess): ListenPlan {
  return access.privateChannels
    ? { mode: "private", token: access.token, expiresAt: access.expiresAt }
    : { mode: "public" };
}

/** Null when the server could not say: unreachable, no credential, or not configured. */
async function askServer(): Promise<ListenPlan | null> {
  const result = await callScanbyApi<unknown>("/print-stations/realtime-token", {
    method: "POST",
    stationOnly: true,
  });
  if (result.kind === "rejected" && result.status === 404) {
    // A server from before private channels: they are public there.
    return { mode: "public" };
  }
  if (result.kind !== "ok") {
    return null;
  }
  const access = parseRealtimeAccess(result.data);
  if (!access) {
    return null;
  }
  saveRealtimeMode(access.privateChannels);
  return toPlan(access);
}

/** What to join right now: the server's answer, else the mode it last told us. */
export async function resolveListenPlan(): Promise<ListenPlan> {
  const plan = await askServer();
  if (plan) {
    return plan;
  }
  return getConfig()?.realtimePrivate === true
    ? { mode: "private-unauthorized" }
    : { mode: "public" };
}

export type ListenPlanHandlers = {
  /** The server switched modes: rejoin from scratch. */
  restart: () => void;
  /** A fresh token for the channel already joined. */
  refreshToken: (token: string) => void;
};

function defaultCheckDelay(plan: ListenPlan): number {
  return plan.mode === "private"
    ? nextRealtimeCheckDelay({ privateChannels: true, ...plan }, Date.now())
    : REALTIME_MODE_POLL_MS;
}

/**
 * Re-asks the server before the token expires, or every few minutes while
 * public, so a station follows the server's mode without a new build.
 */
export function watchListenPlan(
  current: ListenPlan,
  handlers: ListenPlanHandlers,
  delayMs = defaultCheckDelay(current),
): void {
  stopWatchingListenPlan();
  const watching = generation;
  checkTimer = setTimeout(() => {
    checkTimer = null;
    void askServer().then((next) => {
      if (watching !== generation) {
        return;
      }
      if (!next) {
        // Keep listening on what we have; ask again soon.
        watchListenPlan(current, handlers, REFRESH_RETRY_MS);
        return;
      }
      if (next.mode !== current.mode) {
        log.info(`Realtime channels are now ${next.mode} — rejoining`);
        handlers.restart();
        return;
      }
      if (next.mode === "private") {
        handlers.refreshToken(next.token);
      }
      watchListenPlan(next, handlers);
    });
  }, delayMs);
}

export function stopWatchingListenPlan(): void {
  generation += 1;
  if (checkTimer) {
    clearTimeout(checkTimer);
    checkTimer = null;
  }
}
