import { ipcMain } from "electron";
import log from "electron-log";
import { buildRendererAppState } from "@/main/ipc/renderer-state";
import { hideSetupWindow, showSetupWindow } from "@/main/window-manager";
import { appState } from "@/services/app-state";
import { getConfig, getSafeConfigSummary } from "@/services/config-store";
import { showPostSetupTrayDiscovery } from "@/services/post-setup-tray";
import { findEntryById, recordPrint } from "@/services/print-history-store";
import { printQueue } from "@/services/print-queue";
import { connectToPrinter, reconnectPrinter } from "@/services/printer-connection";
import { probePrinter } from "@/services/printer-discovery";
import { runPrinterScan } from "@/services/printer-scan-service";
import { testPrint } from "@/services/printer-service";
import { unpairApp } from "@/services/unpair";
import { checkForUpdates, getUpdateState, quitAndInstallUpdate } from "@/services/update-state";

export function registerIpcHandlers(): void {
  ipcMain.handle("app:get-state", () => buildRendererAppState());

  ipcMain.handle("app:get-config-summary", () => {
    return getSafeConfigSummary();
  });

  ipcMain.handle("printer:scan", async () => {
    try {
      return await runPrinterScan();
    } catch (error) {
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
    await connectToPrinter(ip);
    return { ok: true };
  });

  ipcMain.handle("printer:switch-ip", async (_event, ip: string) => {
    if (typeof ip !== "string" || !ip.trim()) {
      throw new Error("Invalid IP");
    }
    try {
      await connectToPrinter(ip.trim());
      return { ok: true };
    } catch (error) {
      log.error("Printer switch failed", error);
      throw error;
    }
  });

  ipcMain.handle("printer:reconnect", async () => {
    try {
      return await reconnectPrinter();
    } catch (error) {
      log.error("Printer reconnect failed", error);
      throw error;
    }
  });

  ipcMain.handle("app:open-settings", () => {
    return getConfig()
      ? {
          businessName: getConfig()?.businessName ?? null,
          printerIp: getConfig()?.printerIp ?? null,
        }
      : null;
  });

  ipcMain.handle("printer:clear-picker", () => {
    appState.clearPendingPrinterPicker();
    return { ok: true };
  });

  ipcMain.handle("app:unpair", async () => {
    await unpairApp();
    showSetupWindow();
    return { ok: true };
  });

  ipcMain.handle("app:hide-to-tray", () => {
    showPostSetupTrayDiscovery();
    hideSetupWindow();
    return { ok: true };
  });

  ipcMain.handle("print:retry", (_event, entryId: string) => {
    if (typeof entryId !== "string" || !entryId.trim()) {
      throw new Error("Invalid entry ID");
    }

    const entry = findEntryById(entryId.trim());
    if (!entry?.payload) {
      throw new Error("Cannot retry — order data missing");
    }

    const queued = printQueue.enqueue(entry.payload, {
      source: "manual",
      event: "order_updated",
    });

    return { ok: queued };
  });

  ipcMain.handle("update:check", async () => checkForUpdates());

  ipcMain.handle("update:get-state", () => getUpdateState());

  ipcMain.handle("update:install", () => {
    quitAndInstallUpdate();
    return { ok: true };
  });
}
