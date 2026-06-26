import { app, BrowserWindow } from "electron";
import log from "electron-log";

import { initAutoUpdater } from "@/main/auto-updater";
import { registerIpcHandlers } from "@/main/ipc/handlers";
import {
  bootstrapServices,
  configureLogging,
  handleProtocolOpen,
  registerProtocolHandler,
  shutdownServices,
} from "@/main/lifecycle";
import { initTray } from "@/main/tray";
import { showSetupWindow, showWindowForStartup } from "@/main/window-manager";
import { appState } from "@/services/app-state";

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  configureLogging();
  registerProtocolHandler();
  registerIpcHandlers();

  app.on("second-instance", (_event, argv) => {
    const protocolUrl = argv.find((arg) => arg.startsWith("scanby://"));
    if (protocolUrl) {
      handleProtocolOpen(protocolUrl, () => showSetupWindow());
      return;
    }
    if (argv.includes("--hidden")) {
      return;
    }
    showSetupWindow();
  });

  app.on("open-url", (event, url) => {
    event.preventDefault();
    handleProtocolOpen(url, () => showSetupWindow());
  });

  app.whenReady().then(async () => {
    try {
      await bootstrapServices();

      appState.on("change", (snapshot) => {
        if (snapshot.paired && !snapshot.setupComplete) {
          showSetupWindow();
        }
      });

      initTray({
        label: "Quit",
        click: () => {
          app.quit();
        },
      });

      showWindowForStartup();

      initAutoUpdater();

      log.info("Scanby Print Service ready");
    } catch (error) {
      log.error("Startup failed", error);
      app.quit();
    }
  });

  app.on("window-all-closed", () => {
    // Keep running in tray on all platforms
  });

  app.on("before-quit", () => {
    void shutdownServices();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      showSetupWindow();
    }
  });
}
