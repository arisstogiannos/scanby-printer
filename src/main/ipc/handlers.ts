import { ipcMain } from "electron";
import log from "electron-log";
import { hideSetupWindow, showSetupWindow } from "@/main/window-manager";
import { appState } from "@/services/app-state";
import { enableAutoLaunch } from "@/services/auto-launch";
import {
  getConfig,
  getSafeConfigSummary,
  isConfigured,
  isPaired,
  savePrinterIp,
} from "@/services/config-store";
import { getPrintHistory, recordPrint } from "@/services/print-history-store";
import { probePrinter, scanForPrinters } from "@/services/printer-discovery";
import { testPrint } from "@/services/printer-service";
import { unpairApp } from "@/services/unpair";

export function registerIpcHandlers(): void {
  ipcMain.handle("app:get-state", () => {
    const config = getConfig();
    return {
      ...appState.getSnapshot(),
      setupStage: appState.getSetupStage(),
      paired: isPaired(),
      configured: isConfigured(),
      configSummary: getSafeConfigSummary(),
      printHistory: isPaired() ? getPrintHistory(config?.businessId) : [],
    };
  });

  ipcMain.handle("app:get-config-summary", () => {
    return getSafeConfigSummary();
  });

  ipcMain.handle("printer:scan", async () => {
    appState.setPrinterStatus("scanning");
    try {
      const printers = await scanForPrinters();
      if (printers.length > 0) {
        appState.setPrinterStatus("online");
      } else {
        appState.setPrinterStatus("offline");
      }
      return { printers };
    } catch (error) {
      appState.setPrinterStatus("offline");
      log.error("Printer scan failed", error);
      throw error;
    }
  });

  ipcMain.handle("printer:probe", async (_event, ip: string) => {
    if (typeof ip !== "string" || !ip.trim()) {
      throw new Error("Invalid IP");
    }
    return probePrinter(ip.trim());
  });

  ipcMain.handle("printer:test", async (_event, ip: string) => {
    if (typeof ip !== "string" || !ip.trim()) {
      throw new Error("Invalid IP");
    }
    try {
      await testPrint(ip.trim());
      recordPrint({
        orderId: "test",
        orderNumber: 0,
        table: "—",
        source: "test",
        status: "printed",
        payload: {
          id: "test",
          number: 0,
          table: "—",
          items: [{ quantity: 1, name: "Test print" }],
          createdAt: new Date().toISOString(),
        },
      });
      return { ok: true };
    } catch (error) {
      recordPrint({
        orderId: "test",
        orderNumber: 0,
        table: "—",
        source: "test",
        status: "failed",
        payload: {
          id: "test",
          number: 0,
          table: "—",
          items: [{ quantity: 1, name: "Test print" }],
          createdAt: new Date().toISOString(),
        },
        error: error instanceof Error ? error.message : "Test print failed",
      });
      throw error;
    }
  });

  ipcMain.handle("printer:save", async (_event, ip: string) => {
    if (typeof ip !== "string" || !ip.trim()) {
      throw new Error("Invalid IP");
    }
    const printerIp = ip.trim();
    const reachable = await probePrinter(printerIp);
    if (!reachable) {
      throw new Error("Printer not reachable at this IP");
    }

    savePrinterIp(printerIp);
    appState.setPrinterIp(printerIp);
    appState.setPrinterStatus("online");
    appState.setSetupComplete();
    await enableAutoLaunch();
    hideSetupWindow();
    return { ok: true };
  });

  ipcMain.handle("app:open-settings", () => {
    return getConfig()
      ? {
          businessName: getConfig()?.businessName ?? null,
          printerIp: getConfig()?.printerIp ?? null,
        }
      : null;
  });

  ipcMain.handle("app:unpair", async () => {
    await unpairApp();
    showSetupWindow();
    return { ok: true };
  });
}
