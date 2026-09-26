import type { Request, Response } from "express";
import { appState } from "@/services/app-state";
import { getConfig, isPaired } from "@/services/config-store";
import { isKitchenTicketPrintingEnabled } from "@/services/printer-registry";

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
    // The aggregate stays first and keeps its old meaning, so a dashboard
    // older than the registry reads this response exactly as it always did.
    printer: snapshot.printerStatus,
    businessName: snapshot.businessName,
    paired,
    printers: snapshot.printers,
    kitchenTicketsEnabled: isKitchenTicketPrintingEnabled(),
    unroutableFiscalCount: snapshot.unroutableFiscalCount,
  });
}
