import log from "electron-log";
import { appState } from "@/services/app-state";
import { disableAutoLaunch } from "@/services/auto-launch";
import { clearConfig, isPaired } from "@/services/config-store";
import { clearPrintHistory } from "@/services/print-history-store";
import { printQueue } from "@/services/print-queue";
import { receiptPrintQueue } from "@/services/receipt-print-queue";
import { removeStation, stopStationHeartbeat } from "@/services/station-heartbeat";
import { shutdownSupabaseListener } from "@/services/supabase-listener";

export async function unpairApp(): Promise<void> {
  if (!isPaired()) {
    return;
  }

  // Before the config goes: the DELETE needs the business it is leaving.
  stopStationHeartbeat();
  await removeStation();
  await shutdownSupabaseListener();
  printQueue.clear();
  receiptPrintQueue.clear();
  await disableAutoLaunch();
  clearConfig();
  clearPrintHistory();
  appState.reset();
  log.info("Venue unlinked — waiting for new pair request");
}
