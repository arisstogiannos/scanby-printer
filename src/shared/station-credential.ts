/**
 * This station's own credential, issued by a signed-in Scanby dashboard on
 * this PC and bound to one business: `scanby-station.<credentialId>.<secret>`.
 * It replaces the shared PRINT_CLAIM_SECRET compiled into older builds, which
 * this build still falls back to while it has no credential of its own.
 */

/** What `/status` reports, so the dashboard on this PC knows to issue one. */
export type StationCredentialState = "missing" | "ok" | "rejected";

export type ScanbyAuth = {
  authorization: string;
  kind: "station" | "secret";
};

/**
 * A credential the server turned down is tried again this often, in case the
 * refusal was a mistake on the server's side; a fallback secret covers the
 * time between.
 */
export const REJECTED_CREDENTIAL_RETRY_MS = 15 * 60 * 1000;

const STATION_CREDENTIAL_PATTERN = /^scanby-station\.[A-Za-z0-9-]{8,64}\.[A-Za-z0-9_-]{16,256}$/;

export function isStationCredential(value: unknown): value is string {
  return typeof value === "string" && STATION_CREDENTIAL_PATTERN.test(value);
}

/**
 * Which bearer to send: this station's credential when it has one that the
 * server has not just turned down, else the build's shared secret, else the
 * credential anyway (with nothing to fall back to there is nothing to lose).
 */
export function chooseScanbyAuth(input: {
  credential: string | null | undefined;
  rejectedAt: number | null;
  secret: string | null | undefined;
  now: number;
}): ScanbyAuth | null {
  const secret = input.secret?.trim();
  const credential = input.credential;
  const credentialUsable =
    Boolean(credential) &&
    (input.rejectedAt === null ||
      !secret ||
      input.now - input.rejectedAt >= REJECTED_CREDENTIAL_RETRY_MS);

  if (credential && credentialUsable) {
    return { authorization: `Bearer ${credential}`, kind: "station" };
  }
  if (secret) {
    return { authorization: `Bearer ${secret}`, kind: "secret" };
  }
  return null;
}

export function stationCredentialState(
  credential: string | null | undefined,
  rejectedAt: number | null,
): StationCredentialState {
  if (!credential) {
    return "missing";
  }
  return rejectedAt === null ? "ok" : "rejected";
}

export type StationCredentialPayload = {
  businessId: string;
  stationCredential: string;
  privateChannels?: boolean;
};

/** The dashboard handing an already-paired station its credential. */
export function normalizeStationCredentialPayload(body: unknown): StationCredentialPayload | null {
  if (body === null || typeof body !== "object") {
    return null;
  }
  const o = body as Record<string, unknown>;
  if (typeof o.businessId !== "string" || o.businessId.length === 0) {
    return null;
  }
  if (!isStationCredential(o.stationCredential)) {
    return null;
  }
  return {
    businessId: o.businessId,
    stationCredential: o.stationCredential,
    ...(typeof o.privateChannels === "boolean" ? { privateChannels: o.privateChannels } : {}),
  };
}
