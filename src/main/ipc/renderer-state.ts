import { app } from "electron";
import { appState } from "@/services/app-state";
import { getConfig, getSafeConfigSummary, isConfigured, isPaired } from "@/services/config-store";
import { getPrintHistory } from "@/services/print-history-store";
import { getUpdateState } from "@/services/update-state";
import { getLocale, hasSeenTrayDiscovery } from "@/services/user-preferences";
import type { RendererAppState } from "@/shared/types";

export function buildRendererAppState(): RendererAppState {
  const config = getConfig();
  const snapshot = appState.getSnapshot();

  return {
    ...snapshot,
    version: app.getVersion(),
    locale: getLocale(),
    setupStage: appState.getSetupStage(),
    paired: isPaired(),
    configured: isConfigured(),
    configSummary: getSafeConfigSummary(),
    printHistory: isPaired() ? getPrintHistory(config?.businessId) : [],
    update: getUpdateState(),
    showTrayDiscovery: snapshot.setupComplete && !hasSeenTrayDiscovery(),
  };
}
