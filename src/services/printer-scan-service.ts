import log from "electron-log";
import { appState } from "@/services/app-state";
import { getConfig } from "@/services/config-store";
import { syncSavedPrinterStatus } from "@/services/printer-connection";
import { getLocalSubnet, scanForPrinters } from "@/services/printer-discovery";

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

  await syncSavedPrinterStatus(printerIp);
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
      appState.setLastScan({
        printers,
        subnet,
        completedAt: new Date().toISOString(),
      });
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
