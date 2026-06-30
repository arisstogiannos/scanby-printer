import { BrowserWindow } from "electron";
import { buildRendererAppState } from "@/main/ipc/renderer-state";
import { appState } from "@/services/app-state";
import { onPrintHistoryChange } from "@/services/print-history-store";
import { onUpdateStateChange } from "@/services/update-state";

export function broadcastAppState(): void {
  const state = buildRendererAppState();

  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send("app:state-changed", state);
    }
  }
}

export function initStateBroadcaster(): void {
  appState.on("change", () => {
    broadcastAppState();
  });

  onPrintHistoryChange(() => {
    broadcastAppState();
  });

  onUpdateStateChange(() => {
    broadcastAppState();
  });
}
