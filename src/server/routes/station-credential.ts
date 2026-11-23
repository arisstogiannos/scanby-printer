import log from "electron-log";
import type { Request, Response } from "express";
import { getConfig, saveStationCredential } from "@/services/config-store";
import { startPrintSweeps, stopPrintSweeps } from "@/services/print-sweep";
import { syncPrinterRegistry } from "@/services/printer-registry";
import { resetStationCredentialRejection } from "@/services/scanby-auth";
import { startStationHeartbeat } from "@/services/station-heartbeat";
import { restartSupabaseListener } from "@/services/supabase-listener";
import { normalizeStationCredentialPayload } from "@/shared/station-credential";

/**
 * A signed-in dashboard on this PC handing the paired station its own
 * credential: after an update from a build that only had the shared secret,
 * or after the server turned the old credential down. Accepted only for the
 * business this station is paired to; nothing else about the pairing changes.
 */
export async function stationCredentialHandler(req: Request, res: Response): Promise<void> {
  const payload = normalizeStationCredentialPayload(req.body);
  if (!payload) {
    res.status(400).json({ error: "Invalid station credential payload" });
    return;
  }

  const config = getConfig();
  if (!config) {
    res.status(409).json({ error: "Not paired" });
    return;
  }
  if (config.businessId !== payload.businessId) {
    res.status(409).json({ error: "Paired to another business" });
    return;
  }

  try {
    saveStationCredential(payload.stationCredential, payload.privateChannels);
    resetStationCredentialRejection();
    log.info("Station credential received from the dashboard");

    // Everything that authenticates starts over with the new credential: the
    // sweeps (clearing any back-off from refused calls), the check-in, the
    // registry pull, and the channel, which may now join privately.
    stopPrintSweeps();
    startPrintSweeps();
    startStationHeartbeat();
    void syncPrinterRegistry();
    await restartSupabaseListener();
    res.json({ ok: true });
  } catch (error) {
    log.error("Saving the station credential failed", error);
    res.status(500).json({ error: "Station credential failed" });
  }
}
