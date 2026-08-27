import log from "electron-log";
import type { Request, Response } from "express";
import { receiptPrintQueue } from "@/services/receipt-print-queue";
import { normalizePrintReceipt } from "@/shared/receipt-payload";

export function printReceiptHandler(req: Request, res: Response): void {
  const receipt = normalizePrintReceipt(req.body);
  if (!receipt) {
    res.status(400).json({ error: "Invalid receipt payload" });
    return;
  }

  const accepted = receiptPrintQueue.enqueue(receipt, {
    source: "manual",
    event: "receipt_reprint",
  });
  log.info(`Manual receipt print request for ${receipt.id}, accepted=${accepted}`);
  res.json({ ok: true, queued: accepted });
}
