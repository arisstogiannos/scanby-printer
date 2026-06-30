import log from "electron-log";
import type { Request, Response } from "express";
import { appState } from "@/services/app-state";
import { getConfig, savePairing } from "@/services/config-store";
import { retainHistoryForBusiness } from "@/services/print-history-store";
import { printQueue } from "@/services/print-queue";
import { autoConnectPrinterAfterPair } from "@/services/printer-auto-discovery";
import { restartSupabaseListener } from "@/services/supabase-listener";
import { showTrayNotification } from "@/services/tray-notifications";
import { hasSeenPairNotification, markPairNotificationSeen } from "@/services/user-preferences";
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
    }
    appState.setPaired(payload.businessName);
    await restartSupabaseListener();
    log.info(`Paired with business ${payload.businessName}`);

    if (!hasSeenPairNotification()) {
      markPairNotificationSeen();
      showTrayNotification(
        `Connected to ${payload.businessName}`,
        "Choose your kitchen printer to finish setup.",
      );
    }

    void autoConnectPrinterAfterPair();
    res.json({ ok: true });
  } catch (error) {
    log.error("Pair failed", error);
    res.status(500).json({ error: "Pair failed" });
  }
}
