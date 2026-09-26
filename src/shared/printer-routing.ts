import type { PrintDocumentClass, PrinterRole, RegisteredPrinter } from "@/shared/types";

/**
 * Which printers may render which documents.
 *
 * A deliberate, line-for-line mirror of `printer-routing.ts` in the Scanby web
 * app and `PrinterRouting.java` in the Android shell. It is duplicated rather
 * than shared because these are three separately deployed programs, and the one
 * thing worse than three copies of this table is two of them disagreeing about
 * whether a kitchen ticket may come out of the till printer. Change one, change
 * all three.
 */
const ROLES_FOR_DOCUMENT: Record<PrintDocumentClass, readonly PrinterRole[]> = {
  kitchen_ticket: ["KITCHEN", "ALL"],
  // An 8.6 Δελτίο Παραγγελίας is a legal document handed to the table, so it
  // follows the receipt rather than the kitchen ticket it is raised alongside.
  order_slip: ["FISCAL", "ALL"],
  fiscal_receipt: ["FISCAL", "ALL"],
};

export function printerAcceptsDocument(
  role: PrinterRole,
  documentClass: PrintDocumentClass,
): boolean {
  return ROLES_FOR_DOCUMENT[documentClass].includes(role);
}

/**
 * Every printer this document should come out of — all of them, not the first.
 * A venue with a bar printer and a grill printer both set to `KITCHEN` is
 * asking for a copy on each.
 */
export function selectPrintTargets(
  printers: readonly RegisteredPrinter[],
  documentClass: PrintDocumentClass,
): RegisteredPrinter[] {
  return printers.filter(
    (printer) => printer.enabled && printerAcceptsDocument(printer.role, documentClass),
  );
}
