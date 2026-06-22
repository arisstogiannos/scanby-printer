import log from "electron-log";
import type { Request, Response } from "express";
import { printQueue } from "@/services/print-queue";
import { normalizePrintOrder } from "@/shared/print-payload";

export function printHandler(req: Request, res: Response): void {
  const order = normalizePrintOrder(req.body);
  if (!order) {
    res.status(400).json({ error: "Invalid order payload" });
    return;
  }

  const accepted = printQueue.enqueue(order, { source: "manual", event: "order_updated" });
  log.info(`Manual print request for order ${order.id}, accepted=${accepted}`);
  res.json({ ok: true, queued: accepted });
}
