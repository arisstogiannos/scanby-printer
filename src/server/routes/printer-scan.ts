import log from "electron-log";
import type { Request, Response } from "express";
import { runPrinterScan } from "@/services/printer-scan-service";

export async function printerScanHandler(_req: Request, res: Response): Promise<void> {
  try {
    const result = await runPrinterScan();
    res.json(result);
  } catch (error) {
    log.error("Printer scan failed", error);
    res.status(500).json({ error: "Printer scan failed" });
  }
}
