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
import { getRoutablePrinters, syncPrinterRegistry } from "@/services/printer-registry";

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

type ConnectToPrinterOptions = {
  /**
   * Files the printer in the venue's registry. Off when the dashboard asked
   * for the connect: it registers the printer itself, with the name typed.
   */
  report?: boolean;
  /**
   * The address this same printer answered on before it moved (auto-rescan),
   * so the registry re-addresses its row instead of filing a second printer.
   */
  previousAddress?: string;
};

export async function connectToPrinter(
  ip: string,
  { report = true, previousAddress }: ConnectToPrinterOptions = {},
): Promise<{ ip: string }> {
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
  appState.setSavedPrinterStatus("online");
  appState.setSetupComplete();
  appState.clearPendingPrinterPicker();
  await enableAutoLaunch();
  // A printer connected here — from the window, or found again after its IP
  // moved — must reach the registry, or the dashboard never hears of it and
  // this station keeps routing to the old list.
  if (report) {
    void syncPrinterRegistry({ reportAddress: printerIp, previousAddress });
  }

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

  appState.setSavedPrinterStatus(reachable ? "online" : "offline");
  return { online: reachable, ip: printerIp };
}

async function probeSavedPrinter(): Promise<{ online: boolean; ip: string | null }> {
  if (!isPaired()) {
    return { online: false, ip: null };
  }

  const printerIp = appState.getSnapshot().printerIp ?? getConfig()?.printerIp ?? null;
  if (!printerIp) {
    appState.setSavedPrinterStatus("offline");
    return { online: false, ip: null };
  }

  const result = await syncSavedPrinterStatus(printerIp);
  return { online: result.online, ip: result.ip };
}

/**
 * Probes every registered printer and records each one's reachability.
 *
 * Per-printer rather than aggregate, because the two facts a venue needs are
 * different: "something is printing" is not the same as "the till printer is
 * reachable", and it is the second that decides whether a receipt has anywhere
 * to go. Probes run together — a venue with four printers should not wait four
 * timeouts to learn they are all unplugged.
 */
export async function refreshAllPrinterStatuses(): Promise<void> {
  const printers = getRoutablePrinters().filter(
    (printer) => printer.enabled && printer.transport === "LAN",
  );
  if (printers.length === 0) {
    return;
  }

  await Promise.all(
    printers.map(async (printer) => {
      const reachable = await probeSavedPrinterReachable(printer.address);
      appState.setPrinterStatusById(printer.id, reachable ? "online" : "offline");
    }),
  );
}
