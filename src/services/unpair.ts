import log from "electron-log";
import { appState } from "@/services/app-state";
import { clearConfig, isPaired } from "@/services/config-store";
import { clearPrintHistory } from "@/services/print-history-store";
import { shutdownSupabaseListener } from "@/services/supabase-listener";

export async function unpairApp(): Promise<void> {
  if (!isPaired()) {
    return;
  }

  await shutdownSupabaseListener();
  clearConfig();
  clearPrintHistory();
  appState.reset();
  log.info("Venue unlinked — waiting for new pair request");
}
