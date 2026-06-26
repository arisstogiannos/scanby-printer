import log from "electron-log";
import { appState } from "@/services/app-state";
import { reconnectPrinter } from "@/services/printer-connection";
import { PRINTER_RECONNECT_INTERVAL_MS, PRINTER_RECONNECT_MAX_MS } from "@/shared/constants";
import type { PrinterStatus } from "@/shared/types";

let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;
let attemptInFlight = false;
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
      log.info(`Printer reconnected at ${result.ip}`);
      return;
    }
    log.debug(`Printer still unreachable at ${result.ip}, retrying...`);
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
  lastPrinterStatus = null;
}
