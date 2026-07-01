import { contextBridge, ipcRenderer } from "electron";
import type { Locale, RendererAppState, UpdateState } from "@/shared/types";

export type { RendererAppState };

const api = {
  getAppState: (): Promise<RendererAppState> => ipcRenderer.invoke("app:get-state"),
  setLocale: (locale: Locale): Promise<RendererAppState> =>
    ipcRenderer.invoke("app:set-locale", locale),
  onAppStateChange: (callback: (state: RendererAppState) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: RendererAppState) => {
      callback(state);
    };
    ipcRenderer.on("app:state-changed", listener);
    return () => {
      ipcRenderer.removeListener("app:state-changed", listener);
    };
  },
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
  hideToTray: (): Promise<{ ok: boolean }> => ipcRenderer.invoke("app:hide-to-tray"),
  retryPrint: (entryId: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("print:retry", entryId),
  checkForUpdates: (): Promise<UpdateState> => ipcRenderer.invoke("update:check"),
  installUpdate: (): Promise<{ ok: boolean }> => ipcRenderer.invoke("update:install"),
};

contextBridge.exposeInMainWorld("scanbyPrint", api);

export type ScanbyPrintApi = typeof api;
