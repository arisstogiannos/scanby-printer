import { join, resolve } from "node:path";
import { app } from "electron";
import log from "electron-log";
import { startLocalServer, stopLocalServer } from "@/server/index";
import { appState } from "@/services/app-state";
import { enableAutoLaunch, initAutoLaunch } from "@/services/auto-launch";
import { getConfig, initConfigStore, isConfigured, isPaired } from "@/services/config-store";
import { initPrintHistoryStore } from "@/services/print-history-store";
import { printQueue } from "@/services/print-queue";
import { probePrinter } from "@/services/printer-discovery";
import { restartSupabaseListener, shutdownSupabaseListener } from "@/services/supabase-listener";

export function configureLogging(): void {
  log.transports.file.resolvePathFn = () => join(app.getPath("userData"), "logs", "main.log");
  log.transports.file.level = "info";
  log.transports.console.level = "debug";
}

export async function bootstrapServices(): Promise<void> {
  const userDataPath = app.getPath("userData");
  initConfigStore(userDataPath);
  initPrintHistoryStore(userDataPath);
  initAutoLaunch("Scanby Print Service");

  await startLocalServer();

  const config = getConfig();
  log.info("config", config);
  log.info("isPaired", isPaired());
  log.info("isConfigured", isConfigured());
  if (isPaired() && config) {
    appState.setPaired(config.businessName);
    if (config.printerIp) {
      appState.setPrinterIp(config.printerIp);
      const online = await probePrinter(config.printerIp);
      appState.setPrinterStatus(online ? "online" : "offline");
    }
    if (isConfigured()) {
      appState.setSetupComplete();
      await enableAutoLaunch();
    }
    log.info("starting supabase listener");
    await restartSupabaseListener();
  }
}

export async function shutdownServices(): Promise<void> {
  await printQueue.drain();
  await shutdownSupabaseListener();
  await stopLocalServer();
}

export function registerProtocolHandler(): void {
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient("scanby", process.execPath, [resolve(process.argv[1])]);
    }
  } else {
    app.setAsDefaultProtocolClient("scanby");
  }
}

export function handleProtocolOpen(url: string, onStart: () => void): void {
  if (url.startsWith("scanby://")) {
    log.info(`Protocol open: ${url}`);
    onStart();
  }
}
