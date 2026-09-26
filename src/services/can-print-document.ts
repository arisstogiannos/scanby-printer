import { getConfig } from "@/services/config-store";
import { getRoutablePrinters } from "@/services/printer-registry";
import { selectPrintTargets } from "@/shared/printer-routing";
import type { PrintDocumentClass } from "@/shared/types";

/**
 * Whether this station would put the document on paper, mirroring how the
 * queues route it. Asked before claiming a relayed reprint: this station's
 * claims never lapse, so claiming a receipt it has no fiscal printer for
 * would take it away for good from a phone that has one.
 */
export function canPrintDocument(documentClass: PrintDocumentClass): boolean {
  const hasConfiguredPrinter = Boolean(getConfig()?.printerIp);
  if (documentClass === "kitchen_ticket") {
    // With no kitchen role anywhere the ticket goes to the configured printer.
    return hasConfiguredPrinter;
  }
  const printers = getRoutablePrinters();
  return (
    selectPrintTargets(printers, documentClass).length > 0 ||
    // Pre-roles: no registry at all, and the configured printer takes everything.
    (printers.length === 0 && hasConfiguredPrinter)
  );
}
