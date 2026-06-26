import { appState } from "@/services/app-state";
import { enableAutoLaunch } from "@/services/auto-launch";
import { getConfig, isPaired, savePrinterIp } from "@/services/config-store";
import { probePrinter } from "@/services/printer-discovery";

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

  const reachable = await probePrinter(printerIp);
  if (!reachable) {
    throw new PrinterConnectError("unreachable", "Printer not reachable at this IP");
  }

  savePrinterIp(printerIp);
  appState.setPrinterIp(printerIp);
  appState.setPrinterStatus("online");
  appState.setSetupComplete();
  await enableAutoLaunch();

  return { ip: printerIp };
}

export async function reconnectPrinter(): Promise<{ online: boolean; ip: string | null }> {
  if (!isPaired()) {
    return { online: false, ip: null };
  }

  const printerIp = appState.getSnapshot().printerIp ?? getConfig()?.printerIp ?? null;
  if (!printerIp) {
    appState.setPrinterStatus("offline");
    return { online: false, ip: null };
  }

  const reachable = await probePrinter(printerIp);
  appState.setPrinterStatus(reachable ? "online" : "offline");
  return { online: reachable, ip: printerIp };
}
