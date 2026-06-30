import log from "electron-log";
import { CharacterSet, PrinterTypes, ThermalPrinter } from "node-thermal-printer";
import { appState } from "@/services/app-state";
import { beginPrintOperation, endPrintOperation } from "@/services/printer-activity";
import { probeSavedPrinterReachable } from "@/services/printer-discovery";
import { CENTS_PER_EUR, PRINTER_PORT } from "@/shared/constants";
import type { OrderPrintEvent, PrintOrder, PrintOrderItem } from "@/shared/types";

const EVENT_HEADERS: Record<OrderPrintEvent, string> = {
  order_created: "ΝΕΑ ΠΑΡΑΓΓΕΛΙΑ",
  order_updated: "ΕΝΗΜΕΡΩΣΗ",
  order_cancelled: "ΑΚΥΡΩΣΗ",
};

const EVENT_FOOTERS: Partial<Record<OrderPrintEvent, string>> = {
  order_updated: "ΕΠΑΝΕΚΤΥΠΩΣΗ",
  order_cancelled: "Η παραγγελία ακυρώθηκε",
};

function createPrinter(printerIp: string): ThermalPrinter {
  return new ThermalPrinter({
    type: PrinterTypes.EPSON,
    interface: `tcp://${printerIp}:${PRINTER_PORT}`,
    characterSet: CharacterSet.PC737_GREEK,
    removeSpecialCharacters: false,
    lineCharacter: "-",
    options: {
      timeout: 5000,
    },
  });
}

function formatPreferencesNotes(notes?: string): string | undefined {
  if (!notes?.trim()) {
    return undefined;
  }
  return notes.trim();
}

function formatOrderTotal(totalCents: number): string {
  return new Intl.NumberFormat("el-GR", {
    style: "currency",
    currency: "EUR",
  }).format(totalCents / CENTS_PER_EUR);
}

function calculateOrderTotalCents(items: PrintOrderItem[]): number | undefined {
  if (items.length === 0) {
    return undefined;
  }

  let totalCents = 0;
  for (const item of items) {
    if (
      item.price === undefined ||
      !Number.isInteger(item.price) ||
      item.price < 0 ||
      !Number.isFinite(item.quantity) ||
      item.quantity <= 0
    ) {
      return undefined;
    }
    totalCents += item.quantity * item.price;
  }

  return totalCents;
}

export function buildTicketLines(
  order: PrintOrder,
  event: OrderPrintEvent = "order_created",
): {
  headerLine: string;
  tableLine: string;
  itemLines: Array<{ main: string; note?: string }>;
  totalLine?: string;
  footerLine?: string;
  timeLine: string;
  showItems: boolean;
} {
  const createdAt = new Date(order.createdAt);
  const timeLine = Number.isNaN(createdAt.getTime())
    ? new Date().toLocaleTimeString("el-GR")
    : createdAt.toLocaleTimeString("el-GR");

  const tableSuffix = order.number > 0 ? `  #${order.number}` : "";
  const tableLine =
    event === "order_cancelled" && order.table === "?"
      ? `ORDER ${order.id.slice(0, 8)}`
      : `TABLE ${order.table}${tableSuffix}`;

  const orderTotalCents = calculateOrderTotalCents(order.items);

  return {
    headerLine: EVENT_HEADERS[event],
    tableLine,
    itemLines: order.items.map((item) => ({
      main: `${item.quantity}x  ${item.name}`,
      note: formatPreferencesNotes(item.notes),
    })),
    totalLine:
      orderTotalCents !== undefined && event !== "order_cancelled"
        ? formatOrderTotal(orderTotalCents)
        : undefined,
    footerLine: EVENT_FOOTERS[event],
    timeLine,
    showItems: event !== "order_cancelled" && order.items.length > 0,
  };
}

async function renderOrder(
  printer: ThermalPrinter,
  order: PrintOrder,
  event: OrderPrintEvent = "order_created",
): Promise<void> {
  const { headerLine, tableLine, itemLines, totalLine, footerLine, timeLine, showItems } =
    buildTicketLines(order, event);

  printer.alignCenter();
  printer.bold(true);
  printer.setTextDoubleHeight();
  printer.println(headerLine);
  printer.setTextNormal();
  printer.bold(false);
  printer.newLine();

  printer.bold(true);
  printer.println(tableLine);
  printer.bold(false);
  printer.drawLine();

  if (showItems) {
    for (const item of itemLines) {
      printer.alignLeft();
      printer.println(item.main);
      if (item.note) {
        printer.println(`     > ${item.note}`);
      }
    }
    printer.drawLine();
  }

  if (totalLine) {
    printer.alignRight();
    printer.bold(true);
    printer.println(`ΣΥΝΟΛΟ  ${totalLine}`);
    printer.bold(false);
    printer.drawLine();
  }

  if (footerLine) {
    printer.alignCenter();
    printer.bold(true);
    printer.println(footerLine);
    printer.bold(false);
    printer.drawLine();
  }

  printer.alignCenter();
  printer.println(timeLine);
  printer.cut();
}

async function runPrinterJob(
  printerIp: string,
  printer: ThermalPrinter,
  successLabel: string,
): Promise<void> {
  beginPrintOperation();
  appState.setPrinterStatus("printing");

  try {
    await printer.execute();
    appState.setPrinterStatus("online");
    log.info(successLabel);
  } catch (error) {
    const reachable = await probeSavedPrinterReachable(printerIp);
    if (reachable) {
      appState.setPrinterStatus("online");
      log.warn(`Printer job on ${printerIp} reported error but printer is reachable`, error);
      log.info(successLabel);
      return;
    }

    appState.setPrinterStatus("offline");
    log.error(`Printer job failed on ${printerIp}`, error);
    throw error;
  } finally {
    endPrintOperation();
  }
}

export async function printOrder(
  printerIp: string,
  order: PrintOrder,
  event: OrderPrintEvent = "order_created",
): Promise<void> {
  const printer = createPrinter(printerIp);
  await renderOrder(printer, order, event);
  await runPrinterJob(
    printerIp,
    printer,
    `Printed ${event} for order ${order.id} (#${order.number})`,
  );
}

export async function testPrint(printerIp: string): Promise<void> {
  const printer = createPrinter(printerIp);

  printer.alignCenter();
  printer.bold(true);
  printer.println("Scanby Print Service");
  printer.bold(false);
  printer.newLine();
  printer.println("Test print OK");
  printer.println(new Date().toLocaleString("el-GR"));
  printer.cut();

  await runPrinterJob(printerIp, printer, `Test print succeeded on ${printerIp}`);
}
