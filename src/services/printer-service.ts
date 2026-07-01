import log from "electron-log";
import { CharacterSet, PrinterTypes, ThermalPrinter } from "node-thermal-printer";
import { appState } from "@/services/app-state";
import { beginPrintOperation, endPrintOperation } from "@/services/printer-activity";
import { probeSavedPrinterReachable } from "@/services/printer-discovery";
import { getLocale } from "@/services/user-preferences";
import { CENTS_PER_EUR, PRINTER_PORT } from "@/shared/constants";
import type { Locale } from "@/shared/i18n";
import { localeTag, t } from "@/shared/i18n";
import type { OrderPrintEvent, PrintOrder, PrintOrderItem } from "@/shared/types";

function createPrinter(printerIp: string, locale: Locale): ThermalPrinter {
  return new ThermalPrinter({
    type: PrinterTypes.EPSON,
    interface: `tcp://${printerIp}:${PRINTER_PORT}`,
    characterSet: locale === "el" ? CharacterSet.PC737_GREEK : CharacterSet.PC437_USA,
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

const TICKET_LINE_WIDTH = 32;

function formatCentsAsEur(totalCents: number, locale: Locale): string {
  return new Intl.NumberFormat(localeTag(locale), {
    style: "currency",
    currency: "EUR",
  }).format(totalCents / CENTS_PER_EUR);
}

function formatItemMainLine(item: PrintOrderItem, locale: Locale): string {
  const left = `${item.quantity}x  ${item.name}`;

  if (
    item.price === undefined ||
    !Number.isInteger(item.price) ||
    item.price < 0 ||
    !Number.isFinite(item.quantity) ||
    item.quantity <= 0
  ) {
    return left;
  }

  const lineTotalCents = item.quantity * item.price;
  const priceText = formatCentsAsEur(lineTotalCents, locale);
  const padding = Math.max(1, TICKET_LINE_WIDTH - left.length - priceText.length);
  return `${left}${" ".repeat(padding)}${priceText}`;
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

function ticketFooterLine(event: OrderPrintEvent): string | undefined {
  const key = `tickets.footer.${event}`;
  const value = t(key);
  return value === key ? undefined : value;
}

export function buildTicketLines(
  order: PrintOrder,
  event: OrderPrintEvent = "order_created",
  locale: Locale = getLocale(),
): {
  headerLine: string;
  tableLine: string;
  itemLines: Array<{ main: string; note?: string }>;
  totalLine?: string;
  totalLabel: string;
  footerLine?: string;
  timeLine: string;
  showItems: boolean;
} {
  const tag = localeTag(locale);
  const createdAt = new Date(order.createdAt);
  const timeLine = Number.isNaN(createdAt.getTime())
    ? new Date().toLocaleTimeString(tag)
    : createdAt.toLocaleTimeString(tag);

  const tableSuffix = order.number > 0 ? `  #${order.number}` : "";
  const tableLine =
    event === "order_cancelled" && order.table === "?"
      ? t("tickets.order", { id: order.id.slice(0, 8) })
      : t("tickets.table", { table: order.table, suffix: tableSuffix });

  const orderTotalCents = calculateOrderTotalCents(order.items);

  return {
    headerLine: t(`tickets.event.${event}`),
    tableLine,
    itemLines: order.items.map((item) => ({
      main: formatItemMainLine(item, locale),
      note: formatPreferencesNotes(item.notes),
    })),
    totalLine:
      orderTotalCents !== undefined && event !== "order_cancelled"
        ? formatCentsAsEur(orderTotalCents, locale)
        : undefined,
    totalLabel: t("tickets.total"),
    footerLine: ticketFooterLine(event),
    timeLine,
    showItems: event !== "order_cancelled" && order.items.length > 0,
  };
}

async function renderOrder(
  printer: ThermalPrinter,
  order: PrintOrder,
  event: OrderPrintEvent = "order_created",
  locale: Locale = getLocale(),
): Promise<void> {
  const {
    headerLine,
    tableLine,
    itemLines,
    totalLine,
    totalLabel,
    footerLine,
    timeLine,
    showItems,
  } = buildTicketLines(order, event, locale);

  printer.alignCenter();
  printer.bold(true);
  printer.setTextDoubleHeight();
  printer.println(headerLine);
  printer.setTextNormal();
  printer.bold(false);
  printer.setTextDoubleHeight();
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
    printer.println(`${totalLabel}  ${totalLine}`);
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
  printer.setTextNormal();
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
  const locale = getLocale();
  const printer = createPrinter(printerIp, locale);
  await renderOrder(printer, order, event, locale);
  await runPrinterJob(
    printerIp,
    printer,
    `Printed ${event} for order ${order.id} (#${order.number})`,
  );
}

export async function testPrint(printerIp: string): Promise<void> {
  const locale = getLocale();
  const printer = createPrinter(printerIp, locale);
  const tag = localeTag(locale);

  printer.alignCenter();
  printer.bold(true);
  printer.setTextDoubleHeight();
  printer.println(t("tickets.appName"));
  printer.bold(false);
  printer.newLine();
  printer.println(t("tickets.testPrintOk"));
  printer.println(new Date().toLocaleString(tag));
  printer.setTextNormal();
  printer.cut();

  await runPrinterJob(printerIp, printer, `Test print succeeded on ${printerIp}`);
}
