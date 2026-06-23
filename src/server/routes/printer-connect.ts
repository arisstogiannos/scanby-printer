import log from "electron-log";
import type { Request, Response } from "express";
import { connectToPrinter, PrinterConnectError } from "@/services/printer-connection";
import { normalizePrinterConnectPayload } from "@/shared/printer-connect-payload";

export async function printerConnectHandler(req: Request, res: Response): Promise<void> {
  const payload = normalizePrinterConnectPayload(req.body);
  if (!payload) {
    res.status(400).json({ error: "Invalid printer connect payload" });
    return;
  }

  try {
    const result = await connectToPrinter(payload.ip);
    log.info(`Connected printer at ${result.ip}`);
    res.json({ ok: true, printerIp: result.ip });
  } catch (error) {
    if (error instanceof PrinterConnectError) {
      const status = error.code === "not_paired" ? 409 : error.code === "unreachable" ? 422 : 400;
      res.status(status).json({ error: error.message, code: error.code });
      return;
    }

    log.error("Printer connect failed", error);
    res.status(500).json({ error: "Printer connect failed" });
  }
}
