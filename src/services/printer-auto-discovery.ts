import log from "electron-log";
import { hideSetupWindow, showSetupWindow } from "@/main/window-manager";
import { appState } from "@/services/app-state";
import { getConfig, isConfigured } from "@/services/config-store";
import { connectToPrinter } from "@/services/printer-connection";
import { runPrinterScan } from "@/services/printer-scan-service";
import { testPrint } from "@/services/printer-service";
import { showTrayNotification } from "@/services/tray-notifications";

let autoConnectInFlight: Promise<void> | null = null;

export async function autoConnectPrinterAfterPair(): Promise<void> {
  if (autoConnectInFlight) {
    return autoConnectInFlight;
  }

  autoConnectInFlight = (async () => {
    if (isConfigured()) {
      return;
    }

    log.info("Auto-connecting printer after pair...");
    const result = await runPrinterScan();

    if (result.printers.length === 0) {
      log.warn("No printers found after pair — manual setup required");
      showTrayNotification("No printer found", "Open Scanby Print Service to set up your printer.");
      return;
    }

    if (result.printers.length > 1) {
      appState.setPendingPrinterPicker(result.printers);
    }

    const ip = result.printers[0];
    log.info(`Auto-connect: using first discovered printer at ${ip}`);

    try {
      await testPrint(ip);
      await connectToPrinter(ip);
      const body =
        result.printers.length > 1
          ? `Connected to ${ip} (first of ${result.printers.length}). Rescan in settings to change.`
          : `Connected to ${ip} automatically.`;
      showTrayNotification("Printer connected", body);
      hideSetupWindow();
    } catch (error) {
      log.error(`Auto-connect failed for ${ip}`, error);
      showTrayNotification(
        "Printer setup needed",
        `Found printer at ${ip} but test print failed. Open settings to finish setup.`,
      );
    }
  })().finally(() => {
    autoConnectInFlight = null;
  });

  return autoConnectInFlight;
}

export type AutoRescanResult =
  | { action: "none" }
  | { action: "switched"; ip: string }
  | { action: "picker"; printers: string[] };

export async function autoRescanForPrinter(): Promise<AutoRescanResult> {
  if (!isConfigured()) {
    return { action: "none" };
  }

  const savedIp = getConfig()?.printerIp ?? null;
  log.info("Auto-rescan triggered after persistent offline");

  const result = await runPrinterScan();

  if (result.printers.length === 0) {
    log.warn("Auto-rescan found no printers");
    return { action: "none" };
  }

  if (result.printers.length === 1) {
    const ip = result.printers[0];
    if (ip === savedIp) {
      return { action: "none" };
    }

    try {
      await connectToPrinter(ip);
      showTrayNotification("Printer moved", `Printer moved to ${ip} — switched automatically`);
      return { action: "switched", ip };
    } catch (error) {
      log.error(`Auto-rescan failed to switch to ${ip}`, error);
      return { action: "none" };
    }
  }

  if (savedIp && result.printers.includes(savedIp)) {
    return { action: "none" };
  }

  appState.setPendingPrinterPicker(result.printers);
  showTrayNotification(
    "Multiple printers found",
    "Open Scanby Print Service to choose the correct printer.",
  );
  showSetupWindow();
  return { action: "picker", printers: result.printers };
}
