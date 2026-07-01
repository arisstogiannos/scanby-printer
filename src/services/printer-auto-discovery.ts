import log from "electron-log";
import { hideSetupWindow, showSetupWindow } from "@/main/window-manager";
import { appState } from "@/services/app-state";
import { getConfig, isConfigured } from "@/services/config-store";
import { connectToPrinter } from "@/services/printer-connection";
import { runPrinterScan } from "@/services/printer-scan-service";
import { testPrint } from "@/services/printer-service";
import { showTrayNotification } from "@/services/tray-notifications";
import { t } from "@/shared/i18n";

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
      showTrayNotification(
        t("notifications.noPrinterFound"),
        t("notifications.noPrinterFoundBody"),
      );
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
          ? t("notifications.printerConnectedMany", {
              ip,
              count: result.printers.length,
            })
          : t("notifications.printerConnectedOne", { ip });
      showTrayNotification(t("notifications.printerConnected"), body);
      hideSetupWindow();
    } catch (error) {
      log.error(`Auto-connect failed for ${ip}`, error);
      showTrayNotification(
        t("notifications.printerSetupNeeded"),
        t("notifications.printerSetupNeededBody", { ip }),
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
      showTrayNotification(
        t("notifications.printerMoved"),
        t("notifications.printerMovedBody", { ip }),
      );
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
    t("notifications.multiplePrinters"),
    t("notifications.multiplePrintersBody"),
  );
  showSetupWindow();
  return { action: "picker", printers: result.printers };
}
