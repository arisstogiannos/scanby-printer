import log from "electron-log";
import { appState } from "@/services/app-state";
import { autoRescanForPrinter } from "@/services/printer-auto-discovery";
import { reconnectPrinter } from "@/services/printer-connection";
import {
  AUTO_RESCAN_AFTER_FAILED_PROBES,
  PRINTER_RECONNECT_INTERVAL_MS,
  PRINTER_RECONNECT_MAX_MS,
} from "@/shared/constants";
import type { PrinterStatus } from "@/shared/types";

let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;
let failedProbeCount = 0;
let attemptInFlight = false;
let rescanInFlight = false;
let lastPrinterStatus: PrinterStatus | null = null;
let stopped = true;

function clearReconnectTimer(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function resetBackoff(): void {
  reconnectAttempt = 0;
}

function resetFailedProbes(): void {
  failedProbeCount = 0;
}

function shouldAutoReconnect(): boolean {
  const snapshot = appState.getSnapshot();
  return snapshot.paired && Boolean(snapshot.printerIp) && snapshot.printerStatus === "offline";
}

function scheduleNextAttempt(): void {
  if (stopped || !shouldAutoReconnect()) {
    return;
  }

  clearReconnectTimer();
  const delay = Math.min(
    PRINTER_RECONNECT_INTERVAL_MS * 2 ** reconnectAttempt,
    PRINTER_RECONNECT_MAX_MS,
  );
  reconnectAttempt += 1;

  reconnectTimer = setTimeout(() => {
    void attemptReconnect();
  }, delay);
}

async function attemptReconnect(): Promise<void> {
  if (stopped || attemptInFlight || !shouldAutoReconnect()) {
    return;
  }

  attemptInFlight = true;
  try {
    const result = await reconnectPrinter();
    if (result.online) {
      resetBackoff();
      resetFailedProbes();
      log.info(`Printer reconnected at ${result.ip}`);
      return;
    }

    failedProbeCount += 1;
    log.debug(
      `Printer still unreachable at ${result.ip}, probe ${failedProbeCount}/${AUTO_RESCAN_AFTER_FAILED_PROBES}`,
    );

    if (failedProbeCount >= AUTO_RESCAN_AFTER_FAILED_PROBES && !rescanInFlight) {
      rescanInFlight = true;
      resetFailedProbes();
      try {
        await autoRescanForPrinter();
      } catch (error) {
        log.error("Auto-rescan on offline failed", error);
      } finally {
        rescanInFlight = false;
      }
    }
  } catch (error) {
    log.error("Printer auto-reconnect failed", error);
  } finally {
    attemptInFlight = false;
    scheduleNextAttempt();
  }
}

function onAppStateChange(): void {
  if (stopped) {
    return;
  }

  const snapshot = appState.getSnapshot();
  if (snapshot.printerStatus === "offline" && lastPrinterStatus !== "offline") {
    resetBackoff();
    resetFailedProbes();
  }
  lastPrinterStatus = snapshot.printerStatus;

  if (shouldAutoReconnect()) {
    if (!reconnectTimer && !attemptInFlight) {
      scheduleNextAttempt();
    }
    return;
  }

  clearReconnectTimer();
  resetBackoff();
}

export function startPrinterReconnectMonitor(): void {
  if (!stopped) {
    return;
  }

  stopped = false;
  lastPrinterStatus = appState.getSnapshot().printerStatus;
  appState.on("change", onAppStateChange);
  onAppStateChange();
}

export function shutdownPrinterReconnectMonitor(): void {
  stopped = true;
  appState.off("change", onAppStateChange);
  clearReconnectTimer();
  resetBackoff();
  resetFailedProbes();
  lastPrinterStatus = null;
}
