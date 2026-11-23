/**
 * How this station listens to the venue's order channel, as the server says
 * (`POST /print-stations/realtime-token`): on a public channel with the
 * publishable key, as builds before always did, or on a private one with a
 * short-lived token for this business only. Asked again on a timer, so the
 * server flipping to private channels needs no new build.
 */
export type RealtimeAccess =
  | { privateChannels: false }
  | { privateChannels: true; token: string; expiresAt: number };

/** While public, how often to ask whether the server has gone private. */
export const REALTIME_MODE_POLL_MS = 5 * 60 * 1000;
/** A private token is replaced this long before it expires. */
export const REALTIME_TOKEN_REFRESH_LEAD_MS = 5 * 60 * 1000;
/** Never re-ask faster than this, whatever the server's clock says. */
const MIN_CHECK_DELAY_MS = 30_000;

export function parseRealtimeAccess(data: unknown): RealtimeAccess | null {
  if (data === null || typeof data !== "object") {
    return null;
  }
  const o = data as Record<string, unknown>;
  if (o.privateChannels === false) {
    return { privateChannels: false };
  }
  if (o.privateChannels !== true || typeof o.token !== "string" || o.token.length === 0) {
    return null;
  }
  const expiresAt = typeof o.expiresAt === "string" ? Date.parse(o.expiresAt) : Number.NaN;
  if (Number.isNaN(expiresAt)) {
    return null;
  }
  return { privateChannels: true, token: o.token, expiresAt };
}

/** When to ask the server again: before the token runs out, or the next mode poll. */
export function nextRealtimeCheckDelay(access: RealtimeAccess | null, now: number): number {
  if (access?.privateChannels) {
    return Math.max(access.expiresAt - REALTIME_TOKEN_REFRESH_LEAD_MS - now, MIN_CHECK_DELAY_MS);
  }
  return REALTIME_MODE_POLL_MS;
}
