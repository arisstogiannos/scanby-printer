import { app } from "electron";
import log from "electron-log";
import electronUpdater from "electron-updater";
import { broadcastAppState } from "@/main/ipc/state-broadcaster";
import type { UpdateState } from "@/shared/types";

const { autoUpdater } = electronUpdater;

let state: UpdateState = {
  status: "idle",
  version: null,
  lastCheckedAt: null,
  isStoreBuild: false,
  error: null,
};

const changeListeners = new Set<() => void>();

function emitChange(): void {
  for (const listener of changeListeners) {
    listener();
  }
  broadcastAppState();
}

function setState(patch: Partial<UpdateState>): void {
  state = { ...state, ...patch };
  emitChange();
}

export function onUpdateStateChange(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
}

export function getUpdateState(): UpdateState {
  return { ...state };
}

export function initUpdateState(): void {
  state.isStoreBuild = Boolean(process.windowsStore);
}

export function initAutoUpdater(): void {
  initUpdateState();

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
    setState({ status: "checking", error: null });
  });

  autoUpdater.on("update-available", (info) => {
    log.info("Update available", info.version);
    setState({
      status: "downloading",
      version: info.version ?? null,
      lastCheckedAt: new Date().toISOString(),
      error: null,
    });
  });

  autoUpdater.on("update-not-available", (info) => {
    log.info("App is up to date", info.version);
    setState({
      status: "idle",
      version: null,
      lastCheckedAt: new Date().toISOString(),
      error: null,
    });
  });

  autoUpdater.on("error", (error) => {
    log.error("Auto-updater error", error);
    setState({
      status: "error",
      error: error instanceof Error ? error.message : "Update check failed",
      lastCheckedAt: new Date().toISOString(),
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    log.info("Update downloaded", info.version);
    setState({
      status: "ready",
      version: info.version ?? null,
      lastCheckedAt: new Date().toISOString(),
      error: null,
    });
  });

  autoUpdater.on("download-progress", (progress) => {
    log.info("Update download progress", {
      percent: Math.round(progress.percent),
      transferred: Math.round(progress.transferred / 1024),
      total: Math.round(progress.total / 1024),
    });
  });

  void checkForUpdates();
}

export async function checkForUpdates(): Promise<UpdateState> {
  if (!app.isPackaged || process.windowsStore) {
    setState({
      lastCheckedAt: new Date().toISOString(),
      error: null,
    });
    return getUpdateState();
  }

  try {
    setState({ status: "checking", error: null });
    await autoUpdater.checkForUpdates();
  } catch (error) {
    log.error("Failed to check for updates", error);
    setState({
      status: "error",
      error: error instanceof Error ? error.message : "Update check failed",
      lastCheckedAt: new Date().toISOString(),
    });
  }

  return getUpdateState();
}

export function quitAndInstallUpdate(): void {
  if (!app.isPackaged || process.windowsStore) {
    return;
  }
  autoUpdater.quitAndInstall();
}
