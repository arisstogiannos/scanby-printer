import log from "electron-log";
import { appState } from "@/services/app-state";
import { getConfig } from "@/services/config-store";
import { getLocalSubnet, probePrinter, scanForPrinters } from "@/services/printer-discovery";

export type PrinterScanResult = {
  printers: string[];
  subnet: string | null;
};

let scanInFlight: Promise<PrinterScanResult> | null = null;

async function refreshPrinterStatusFromConfig(): Promise<void> {
  const printerIp = getConfig()?.printerIp;
  if (!printerIp) {
    appState.setPrinterStatus("offline");
    return;
  }

  const reachable = await probePrinter(printerIp);
  appState.setPrinterStatus(reachable ? "online" : "offline");
}

export async function runPrinterScan(): Promise<PrinterScanResult> {
  if (scanInFlight) {
    return scanInFlight;
  }

  scanInFlight = (async () => {
    appState.setPrinterStatus("scanning");

    try {
      const subnet = getLocalSubnet();
      const printers = await scanForPrinters(subnet);
      await refreshPrinterStatusFromConfig();
      log.info(`Printer scan found ${printers.length} device(s) on subnet ${subnet ?? "unknown"}`);
      return { printers, subnet };
    } catch (error) {
      await refreshPrinterStatusFromConfig();
      throw error;
    } finally {
      scanInFlight = null;
    }
  })();

  return scanInFlight;
}
