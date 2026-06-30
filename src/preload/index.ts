import { contextBridge, ipcRenderer } from "electron";
import type { AppStateSnapshot, PrintHistoryEntry } from "@/shared/types";

export type RendererAppState = AppStateSnapshot & {
  version: string;
  setupStage: "waiting-pair" | "printer-setup" | "complete";
  paired: boolean;
  configured: boolean;
  configSummary: {
    businessId: string | null;
    businessName: string | null;
    printerIp: string | null;
    hasPublishableKey: boolean;
  };
  printHistory: PrintHistoryEntry[];
};

const api = {
  getAppState: (): Promise<RendererAppState> => ipcRenderer.invoke("app:get-state"),
  scanPrinters: (): Promise<{ printers: string[]; subnet: string | null }> =>
    ipcRenderer.invoke("printer:scan"),
  probePrinter: (ip: string): Promise<boolean> => ipcRenderer.invoke("printer:probe", ip),
  testPrint: (ip: string): Promise<{ ok: boolean }> => ipcRenderer.invoke("printer:test", ip),
  savePrinter: (ip: string): Promise<{ ok: boolean }> => ipcRenderer.invoke("printer:save", ip),
  switchPrinterIp: (ip: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("printer:switch-ip", ip),
  reconnectPrinter: (): Promise<{ online: boolean; ip: string | null }> =>
    ipcRenderer.invoke("printer:reconnect"),
  clearPendingPrinterPicker: (): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("printer:clear-picker"),
  unpair: (): Promise<{ ok: boolean }> => ipcRenderer.invoke("app:unpair"),
};

contextBridge.exposeInMainWorld("scanbyPrint", api);

export type ScanbyPrintApi = typeof api;
