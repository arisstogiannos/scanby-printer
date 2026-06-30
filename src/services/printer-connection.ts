import { appState } from "@/services/app-state";
import { enableAutoLaunch } from "@/services/auto-launch";
import { getConfig, isPaired, savePrinterIp } from "@/services/config-store";
import {
  activityChangedSince,
  captureActivityGeneration,
  isInPostPrintGrace,
  shouldBlockProbeStatusUpdate,
  statusLooksOnline,
} from "@/services/printer-activity";
import { probeSavedPrinterReachable } from "@/services/printer-discovery";

export type PrinterConnectErrorCode = "not_paired" | "unreachable" | "invalid_ip";

export class PrinterConnectError extends Error {
  constructor(
    readonly code: PrinterConnectErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PrinterConnectError";
  }
}

export async function connectToPrinter(ip: string): Promise<{ ip: string }> {
  const printerIp = ip.trim();
  if (!printerIp) {
    throw new PrinterConnectError("invalid_ip", "Invalid IP");
  }

  if (!isPaired()) {
    throw new PrinterConnectError("not_paired", "App must be paired before connecting a printer");
  }

  const reachable = await probeSavedPrinterReachable(printerIp);
  if (!reachable) {
    throw new PrinterConnectError("unreachable", "Printer not reachable at this IP");
  }

  savePrinterIp(printerIp);
  appState.setPrinterIp(printerIp);
  appState.setPrinterStatus("online");
  appState.setSetupComplete();
  appState.clearPendingPrinterPicker();
  await enableAutoLaunch();

  return { ip: printerIp };
}

let reconnectInFlight: Promise<{ online: boolean; ip: string | null }> | null = null;

export async function reconnectPrinter(): Promise<{ online: boolean; ip: string | null }> {
  if (reconnectInFlight) {
    return reconnectInFlight;
  }

  reconnectInFlight = probeSavedPrinter().finally(() => {
    reconnectInFlight = null;
  });

  return reconnectInFlight;
}

export async function syncSavedPrinterStatus(
  printerIp: string,
): Promise<{ online: boolean; ip: string }> {
  const currentStatus = appState.getSnapshot().printerStatus;

  if (shouldBlockProbeStatusUpdate(currentStatus)) {
    return { online: statusLooksOnline(currentStatus), ip: printerIp };
  }

  const generationAtStart = captureActivityGeneration();
  const reachable = await probeSavedPrinterReachable(printerIp);
  const statusAfterProbe = appState.getSnapshot().printerStatus;

  if (activityChangedSince(generationAtStart) || shouldBlockProbeStatusUpdate(statusAfterProbe)) {
    return { online: statusLooksOnline(statusAfterProbe), ip: printerIp };
  }

  if (!reachable && isInPostPrintGrace()) {
    return { online: statusLooksOnline(statusAfterProbe), ip: printerIp };
  }

  appState.setPrinterStatus(reachable ? "online" : "offline");
  return { online: reachable, ip: printerIp };
}

async function probeSavedPrinter(): Promise<{ online: boolean; ip: string | null }> {
  if (!isPaired()) {
    return { online: false, ip: null };
  }

  const printerIp = appState.getSnapshot().printerIp ?? getConfig()?.printerIp ?? null;
  if (!printerIp) {
    appState.setPrinterStatus("offline");
    return { online: false, ip: null };
  }

  const result = await syncSavedPrinterStatus(printerIp);
  return { online: result.online, ip: result.ip };
}
