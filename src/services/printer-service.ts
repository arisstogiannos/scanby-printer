import log from "electron-log";
import { CharacterSet, PrinterTypes, ThermalPrinter } from "node-thermal-printer";
import { appState } from "@/services/app-state";
import { PRINTER_PORT } from "@/shared/constants";
import type { OrderPrintEvent, PrintOrder } from "@/shared/types";

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

export function buildTicketLines(
  order: PrintOrder,
  event: OrderPrintEvent = "order_created",
): {
  headerLine: string;
  tableLine: string;
  itemLines: Array<{ main: string; note?: string }>;
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

  return {
    headerLine: EVENT_HEADERS[event],
    tableLine,
    itemLines: order.items.map((item) => ({
      main: `${item.quantity}x  ${item.name}`,
      note: formatPreferencesNotes(item.notes),
    })),
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
  const { headerLine, tableLine, itemLines, footerLine, timeLine, showItems } = buildTicketLines(
    order,
    event,
  );

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

export async function printOrder(
  printerIp: string,
  order: PrintOrder,
  event: OrderPrintEvent = "order_created",
): Promise<void> {
  const printer = createPrinter(printerIp);
  await renderOrder(printer, order, event);

  appState.setPrinterStatus("printing");
  try {
    const success = await printer.execute();
    if (!success) {
      throw new Error("Printer execute returned false");
    }
    appState.setPrinterStatus("online");
    log.info(`Printed ${event} for order ${order.id} (#${order.number})`);
  } catch (error) {
    appState.setPrinterStatus("offline");
    log.error("Print failed", error);
    throw error;
  }
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

  appState.setPrinterStatus("printing");
  try {
    const success = await printer.execute();
    if (!success) {
      throw new Error("Test print execute returned false");
    }
    appState.setPrinterStatus("online");
    log.info(`Test print succeeded on ${printerIp}`);
  } catch (error) {
    appState.setPrinterStatus("offline");
    log.error("Test print failed", error);
    throw error;
  }
}
