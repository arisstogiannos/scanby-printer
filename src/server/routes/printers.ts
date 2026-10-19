import log from "electron-log";
import type { Request, Response } from "express";
import { getConfig } from "@/services/config-store";
import { applyPrinterRegistry, parseRegisteredPrinter } from "@/services/printer-registry";
import { receiptPrintQueue } from "@/services/receipt-print-queue";
import type { RegisteredPrinter } from "@/shared/types";

/** Same bound the server puts on a station's report. */
const MAX_PUSHED_PRINTERS = 32;

/**
 * The registry, pushed by the dashboard open on this PC.
 *
 * The dashboard is the half of the pair with a signed-in session, so it can
 * always read the registry — this app's own pull needs the service secret and
 * a reachable API. Pushing it here keeps names, roles and the printer list in
 * step with the dashboard even when that pull fails. Only the business this
 * app is paired to may push, so another venue's tab cannot reroute it.
 */
export function printersHandler(req: Request, res: Response): void {
  const config = getConfig();
  const body = (req.body ?? {}) as Record<string, unknown>;

  if (!config?.businessId) {
    res.status(409).json({ error: "Not paired" });
    return;
  }
  if (body.businessId !== config.businessId) {
    res.status(409).json({ error: "Paired to another business" });
    return;
  }
  if (!Array.isArray(body.printers)) {
    res.status(400).json({ error: "Invalid printers payload" });
    return;
  }

  const printers = body.printers
    .slice(0, MAX_PUSHED_PRINTERS)
    .map(parseRegisteredPrinter)
    .filter((printer): printer is RegisteredPrinter => printer !== null);

  const routable = applyPrinterRegistry(printers, body.kitchenTicketsEnabled !== false);
  // A role that was just assigned may be exactly what a held receipt was waiting for.
  receiptPrintQueue.retryHeldJobs();
  log.info(`Printer registry pushed by the dashboard: ${printers.length} printer(s)`);
  res.json({ ok: true, printers: routable.length });
}
