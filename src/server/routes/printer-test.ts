import log from "electron-log";
import type { Request, Response } from "express";
import { findPrinterById, withPrinterFontSize } from "@/services/printer-registry";
import { printOrder } from "@/services/printer-service";
import { normalizePrintOrder } from "@/shared/print-payload";

/**
 * Prints the dashboard's sample ticket on one printer, bypassing role routing
 * and the queue: someone is standing at that printer waiting to see whether it
 * works, so it either prints now or the error goes straight back to them.
 */
export async function printerTestHandler(req: Request, res: Response): Promise<void> {
  const body = req.body as { printerId?: unknown };
  const printerId = typeof body?.printerId === "string" ? body.printerId : null;
  const order = normalizePrintOrder(req.body);
  if (!printerId || !order) {
    res.status(400).json({ error: "Invalid test print payload" });
    return;
  }

  const printer = findPrinterById(printerId);
  // Not 404: the dashboard reads that as "app too old for this endpoint" and
  // falls back to a routed test, which would print on some other printer.
  if (!printer) {
    res.status(422).json({ error: "Printer not found", code: "unknown_printer" });
    return;
  }

  try {
    await printOrder(
      printer.address,
      withPrinterFontSize(order, printer),
      "order_updated",
      printer.id,
    );
    res.json({ ok: true });
  } catch (error) {
    log.warn(`Test print failed on ${printer.name}`, error);
    res.status(502).json({ error: "Test print failed" });
  }
}
