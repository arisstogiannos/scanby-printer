import log from "electron-log";
import type { Request, Response } from "express";
import { printQueue } from "@/services/print-queue";
import { normalizeOrderPrintEvent, normalizePrintOrder } from "@/shared/print-payload";

export function printHandler(req: Request, res: Response): void {
  const order = normalizePrintOrder(req.body);
  if (!order) {
    res.status(400).json({ error: "Invalid order payload" });
    return;
  }

  // The dashboard sends the event so the ticket carries the right header; older
  // builds send none, and every one of those calls is a hand-triggered reprint.
  const event =
    normalizeOrderPrintEvent((req.body as { event?: unknown })?.event) ?? "order_updated";
  // A new-order ticket the dashboard dispatched is an auto-print, whichever
  // station won the claim — the badge must not read "manual" just because the
  // browser got there before this app's own realtime listener did.
  const source = event === "order_created" ? "realtime" : "manual";

  // The dashboard dispatches a new-order ticket only after it has won the
  // server-side claim, so this job must not claim again: it would lose against
  // the claim its own caller is holding and the ticket would never print.
  const accepted = printQueue.enqueue(order, {
    source,
    event,
    preClaimed: event === "order_created",
  });
  log.info(`Print request (${event}) for order ${order.id}, accepted=${accepted}`);
  res.json({ ok: true, queued: accepted });
}
