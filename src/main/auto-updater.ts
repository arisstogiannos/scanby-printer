import { app } from "electron";
import log from "electron-log";
import electronUpdater from "electron-updater";

const { autoUpdater } = electronUpdater;

export function initAutoUpdater(): void {
  if (!app.isPackaged || process.windowsStore) {
    log.info("Auto-updater skipped", {
      packaged: app.isPackaged,
      windowsStore: Boolean(process.windowsStore),
    });
    return;
  }

  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.disableWebInstaller = true;

  autoUpdater.on("checking-for-update", () => {
    log.info("Checking for update");
  });

  autoUpdater.on("update-available", (info) => {
    log.info("Update available", info.version);
  });

  autoUpdater.on("update-not-available", (info) => {
    log.info("App is up to date", info.version);
  });

  autoUpdater.on("error", (error) => {
    log.error("Auto-updater error", error);
  });

  autoUpdater.on("update-downloaded", (info) => {
    log.info("Update downloaded", info.version);
  });

  autoUpdater.on("download-progress", (progress) => {
    log.info("Update download progress", {
      percent: Math.round(progress.percent),
      transferred: Math.round(progress.transferred / 1024),
      total: Math.round(progress.total / 1024),
    });
  });

  void autoUpdater
    .checkForUpdatesAndNotify()
    .then((result) => {
      log.info("Check for updates result", result);
    })
    .catch((error: unknown) => {
      log.error("Failed to check for updates", error);
    });
}
