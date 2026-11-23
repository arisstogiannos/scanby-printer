import log from "electron-log";
import { appState } from "@/services/app-state";
import { getConfig } from "@/services/config-store";
import { showTrayNotification } from "@/services/tray-notifications";
import { t } from "@/shared/i18n";
import {
  chooseScanbyAuth,
  type ScanbyAuth,
  type StationCredentialState,
  stationCredentialState,
} from "@/shared/station-credential";

/**
 * When the server last turned this station's credential down; null while it
 * is accepted. In memory on purpose: a restart tries the credential again.
 */
let credentialRejectedAt: number | null = null;
let reconnectNoticeShown = false;

function buildSecret(): string | undefined {
  return process.env.PRINT_CLAIM_SECRET?.trim() || undefined;
}

/** The bearer for the next Scanby API call, or null when this build has none at all. */
export function resolveScanbyAuth(now = Date.now()): ScanbyAuth | null {
  return chooseScanbyAuth({
    credential: getConfig()?.stationCredential,
    rejectedAt: credentialRejectedAt,
    secret: buildSecret(),
    now,
  });
}

/**
 * This station's own credential only, never the shared secret — for what the
 * server grants a station alone, such as a Realtime token for its business.
 */
export function resolveStationAuth(): ScanbyAuth | null {
  const credential = getConfig()?.stationCredential;
  return credential ? { authorization: `Bearer ${credential}`, kind: "station" } : null;
}

export function hasScanbyAuth(): boolean {
  return Boolean(getConfig()?.stationCredential || buildSecret());
}

export function getStationCredentialState(): StationCredentialState {
  return stationCredentialState(getConfig()?.stationCredential, credentialRejectedAt);
}

/**
 * The server answered 401/403 to `kind`. A turned-down credential is set aside
 * for the shared secret while the build has one; without it nothing reaches
 * the server, and the window and the tray say to open the dashboard on this
 * PC, which hands over a new credential by itself.
 */
export function reportScanbyAuthRejected(kind: ScanbyAuth["kind"]): void {
  if (kind === "station") {
    if (credentialRejectedAt === null) {
      log.error(
        "Station credential refused by the server — open the dashboard on this PC to reconnect",
      );
    }
    credentialRejectedAt = Date.now();
    if (buildSecret()) {
      // The shared secret carries on while the server still accepts it.
      return;
    }
  }
  // Nothing left that the server accepts: a refused credential with no secret
  // behind it, or a secret the server has retired.
  flagReconnectNeeded();
}

/**
 * The window and the tray ask for a signed-in dashboard on this PC, which
 * hands over a new credential by itself. Shown once until something works.
 */
export function flagReconnectNeeded(): void {
  appState.setStationNeedsReconnect(true);
  if (!reconnectNoticeShown) {
    reconnectNoticeShown = true;
    showTrayNotification(
      t("notifications.stationReconnect"),
      t("notifications.stationReconnectBody"),
    );
  }
}

/** An authenticated call went through. */
export function reportScanbyAuthAccepted(kind: ScanbyAuth["kind"]): void {
  if (kind === "station") {
    credentialRejectedAt = null;
  }
  reconnectNoticeShown = false;
  appState.setStationNeedsReconnect(false);
}

/** A new credential from the dashboard, or a new pairing: start trusting it again. */
export function resetStationCredentialRejection(): void {
  credentialRejectedAt = null;
  reconnectNoticeShown = false;
  appState.setStationNeedsReconnect(false);
}
