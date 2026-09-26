import log from "electron-log";
import type { Request, Response } from "express";
import { appState } from "@/services/app-state";
import { getConfig, savePairing } from "@/services/config-store";
import { retainHistoryForBusiness } from "@/services/print-history-store";
import { printQueue } from "@/services/print-queue";
import { autoConnectPrinterAfterPair } from "@/services/printer-auto-discovery";
import { syncPrinterRegistry } from "@/services/printer-registry";
import { receiptPrintQueue } from "@/services/receipt-print-queue";
import { removeStation, startStationHeartbeat } from "@/services/station-heartbeat";
import { restartSupabaseListener } from "@/services/supabase-listener";
import { showTrayNotification } from "@/services/tray-notifications";
import { hasSeenPairNotification, markPairNotificationSeen } from "@/services/user-preferences";
import { t } from "@/shared/i18n";
import { normalizePairPayload } from "@/shared/pair-payload";

export async function pairHandler(req: Request, res: Response): Promise<void> {
  const payload = normalizePairPayload(req.body);
  if (!payload) {
    res.status(400).json({ error: "Invalid pair payload" });
    return;
  }

  try {
    const previousBusinessId = getConfig()?.businessId;
    savePairing(payload);
    if (previousBusinessId !== payload.businessId) {
      retainHistoryForBusiness(payload.businessId);
      printQueue.clear();
      receiptPrintQueue.clear();
      // Moving venues without unlinking first: the old one would otherwise
      // keep this station listed as an offline printer.
      if (previousBusinessId) {
        void removeStation(previousBusinessId);
      }
    }
    appState.setPaired(payload.businessName);
    await restartSupabaseListener();
    startStationHeartbeat();
    log.info(`Paired with business ${payload.businessName}`);

    if (!hasSeenPairNotification()) {
      markPairNotificationSeen();
      showTrayNotification(
        t("notifications.connectedToVenue", { venueName: payload.businessName }),
        t("notifications.connectedToVenueBody"),
      );
    }

    void autoConnectPrinterAfterPair();
    // Pulls the venue's printers, and files this station's configured one as
    // an `ALL` printer if the registry is still empty — which is how an
    // existing venue gets into the registry without anyone typing an IP.
    void syncPrinterRegistry();
    res.json({ ok: true });
  } catch (error) {
    log.error("Pair failed", error);
    res.status(500).json({ error: "Pair failed" });
  }
}
