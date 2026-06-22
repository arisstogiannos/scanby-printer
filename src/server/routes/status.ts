import type { Request, Response } from "express";
import { appState } from "@/services/app-state";
import { getConfig, isPaired } from "@/services/config-store";

export function statusHandler(_req: Request, res: Response): void {
  const snapshot = appState.getSnapshot();
  const config = getConfig();
  const paired = isPaired();
  const printerReady = snapshot.printerStatus === "online" || snapshot.printerStatus === "printing";

  res.json({
    online: paired && printerReady,
    venueName: snapshot.businessName ?? undefined,
    venueId: config?.businessId,
    connected: true,
    printer: snapshot.printerStatus,
    businessName: snapshot.businessName,
    paired,
  });
}
