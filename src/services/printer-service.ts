import log from "electron-log";
import { CharacterSet, PrinterTypes, ThermalPrinter } from "node-thermal-printer";
import { appState } from "@/services/app-state";
import { beginPrintOperation, endPrintOperation } from "@/services/printer-activity";
import { probeSavedPrinterReachable } from "@/services/printer-discovery";
import { getLocale } from "@/services/user-preferences";
import { CENTS_PER_EUR, PRINTER_PORT } from "@/shared/constants";
import type { Locale } from "@/shared/i18n";
import { localeTag, t } from "@/shared/i18n";
import type {
  OrderPrintEvent,
  PrintFontSize,
  PrintOrder,
  PrintOrderItem,
  PrintReceipt,
} from "@/shared/types";

let printChain: Promise<void> = Promise.resolve();

function withPrintLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = printChain.then(fn);
  printChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

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

function formatCentsAsEur(totalCents: number, locale: Locale): string {
  return new Intl.NumberFormat(localeTag(locale), {
    style: "currency",
    currency: "EUR",
  }).format(totalCents / CENTS_PER_EUR);
}

function formatItemLine(item: PrintOrderItem, locale: Locale): { label: string; price?: string } {
  const label = `${item.quantity}x  ${item.name}`;

  if (
    item.price === undefined ||
    !Number.isInteger(item.price) ||
    item.price < 0 ||
    !Number.isFinite(item.quantity) ||
    item.quantity <= 0
  ) {
    return { label };
  }

  return {
    label,
    price: formatCentsAsEur(item.quantity * item.price, locale),
  };
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
  staffLine?: string;
  itemLines: Array<{ label: string; price?: string; note?: string }>;
  totalLine?: string;
  totalLabel: string;
  footerLine?: string;
  timeLine: string;
  notFiscalLine: string;
  poweredByLine: string;
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
  const staffName = order.createdByName?.trim();

  return {
    headerLine: t(`tickets.event.${event}`),
    tableLine,
    staffLine: staffName ? t("tickets.staff", { name: staffName }) : undefined,
    itemLines: order.items.map((item) => ({
      ...formatItemLine(item, locale),
      note: formatPreferencesNotes(item.notes),
    })),
    totalLine:
      orderTotalCents !== undefined && event !== "order_cancelled"
        ? formatCentsAsEur(orderTotalCents, locale)
        : undefined,
    totalLabel: t("tickets.total"),
    footerLine: ticketFooterLine(event),
    timeLine,
    notFiscalLine: t("tickets.footerNotFiscal"),
    poweredByLine: t("tickets.footerPoweredBy"),
    showItems: event !== "order_cancelled" && order.items.length > 0,
  };
}

function applyDoubleHeight(printer: ThermalPrinter): void {
  printer.setTextDoubleHeight();
}

function applyBodyTextSize(printer: ThermalPrinter, fontSize?: PrintFontSize): void {
  if (fontSize === "big") {
    printer.setTextDoubleHeight();
    return;
  }
  printer.setTextNormal();
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
    staffLine,
    itemLines,
    totalLine,
    totalLabel,
    footerLine,
    timeLine,
    notFiscalLine,
    poweredByLine,
    showItems,
  } = buildTicketLines(order, event, locale);
  const fontSize = order.fontSize ?? "default";

  printer.alignCenter();
  printer.bold(true);
  applyDoubleHeight(printer);
  printer.println(headerLine);
  printer.bold(false);

  printer.newLine();

  printer.bold(true);
  applyDoubleHeight(printer);
  printer.println(tableLine);
  printer.bold(false);

  if (staffLine) {
    applyBodyTextSize(printer, fontSize);
    printer.alignCenter();
    printer.println(staffLine);
  }

  printer.drawLine();

  if (showItems) {
    applyBodyTextSize(printer, fontSize);
    for (const item of itemLines) {
      if (item.price) {
        printer.leftRight(item.label, item.price);
      } else {
        printer.alignLeft();
        printer.println(item.label);
      }
      if (item.note) {
        printer.alignLeft();
        printer.println(`  > ${item.note}`);
      }
      printer.newLine();
    }
    printer.drawLine();
  }

  if (totalLine) {
    applyBodyTextSize(printer, fontSize);
    printer.alignRight();
    printer.bold(true);
    printer.println(`${totalLabel}  ${totalLine}`);
    printer.bold(false);
    printer.drawLine();
  }

  if (footerLine) {
    applyBodyTextSize(printer, fontSize);
    printer.alignCenter();
    printer.bold(true);
    printer.println(footerLine);
    printer.bold(false);
    printer.drawLine();
  }

  printer.alignCenter();
  applyBodyTextSize(printer, fontSize);
  printer.println(timeLine);

  printer.setTextNormal();
  printer.alignCenter();
  printer.bold(true);
  printer.println(notFiscalLine);
  printer.bold(false);
  printer.println(poweredByLine);
  printer.cut();
}

async function runPrinterJob(
  printerIp: string,
  printer: ThermalPrinter,
  successLabel: string,
): Promise<void> {
  await withPrintLock(async () => {
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
  });
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

function formatReceiptEuro(cents: number): string {
  return `${(cents / CENTS_PER_EUR).toFixed(2)}€`;
}

function formatVatRate(rateBps: number): string {
  return `${(rateBps / 100).toFixed(rateBps % 100 === 0 ? 0 : 2)}%`;
}

function formatReceiptMoment(momentIso: string): string {
  const moment = new Date(momentIso);
  if (Number.isNaN(moment.getTime())) {
    return new Date().toLocaleString("el-GR", { timeZone: "Europe/Athens" });
  }
  return new Intl.DateTimeFormat("el-GR", {
    timeZone: "Europe/Athens",
    dateStyle: "short",
    timeStyle: "medium",
  }).format(moment);
}

function createReceiptPrinter(printerIp: string): ThermalPrinter {
  return createPrinter(printerIp, "el");
}

async function renderReceipt(printer: ThermalPrinter, receipt: PrintReceipt): Promise<void> {
  printer.alignCenter();
  printer.bold(true);
  printer.println(receipt.legalName.toUpperCase());
  printer.bold(false);
  if (receipt.address) {
    printer.println(receipt.address);
  }
  printer.println(`ΑΦΜ: ${receipt.vatId}`);

  printer.newLine();
  printer.bold(true);
  printer.println(receipt.title);
  printer.bold(false);

  printer.leftRight(`${receipt.series} ${receipt.aa}`, formatReceiptMoment(receipt.momentIso));

  if (receipt.cashierName) {
    printer.println(`Χειριστής: ${receipt.cashierName}`);
  }

  if (receipt.customer) {
    printer.drawLine();
    printer.println(`ΠΕΛΑΤΗΣ: ${receipt.customer.name}`);
    printer.println(`ΑΦΜ: ${receipt.customer.vatId}`);
    if (receipt.customer.street) {
      printer.println(
        `${receipt.customer.street}, ${receipt.customer.zip ?? ""} ${receipt.customer.city ?? ""}`.trim(),
      );
    }
  }

  printer.drawLine();
  for (const line of receipt.lines) {
    const qtyPrefix = line.quantity > 1 ? `${line.quantity}x ` : "";
    const label = `${qtyPrefix}${line.name} (${formatVatRate(line.rateBps)})`;
    printer.leftRight(label, formatReceiptEuro(line.totalInCents));
  }

  if (receipt.vatRows.length > 0) {
    printer.drawLine();
    printer.alignLeft();
    printer.println("ΦΠΑ%     ΚΑΘΑΡΗ      ΦΠΑ     ΣΥΝΟΛΟ");
    for (const row of receipt.vatRows) {
      const rate = formatVatRate(row.rateBps).padEnd(6);
      const net = formatReceiptEuro(row.netInCents).padStart(9);
      const vat = formatReceiptEuro(row.vatInCents).padStart(8);
      const gross = formatReceiptEuro(row.grossInCents).padStart(9);
      printer.println(`${rate}${net}${vat}${gross}`);
    }
  }

  printer.drawLine();
  printer.bold(true);
  printer.leftRight("ΣΥΝΟΛΟ", formatReceiptEuro(receipt.totalInCents));
  printer.bold(false);
  printer.leftRight(receipt.payMethodLabel, formatReceiptEuro(receipt.totalInCents));

  if (receipt.transmissionFailure) {
    printer.newLine();
    printer.alignCenter();
    printer.bold(true);
    printer.println(`TRANSMISSION_FAILURE_${receipt.transmissionFailure}`);
    printer.bold(false);
  }

  for (const signature of receipt.signatures) {
    if (signature.caption) {
      printer.alignLeft();
      printer.println(signature.caption);
    }
    if (signature.format === 3) {
      printer.alignCenter();
      printer.printQR(signature.data, { cellSize: 4, correction: "M", model: 2 });
      printer.newLine();
    } else {
      printer.alignLeft();
      printer.println(signature.data);
    }
  }

  if (receipt.qrUrl) {
    printer.alignCenter();
    printer.printQR(receipt.qrUrl, { cellSize: 4, correction: "M", model: 2 });
    printer.newLine();
  }

  printer.alignCenter();
  printer.println("Powered by Scanby Pay");
  printer.cut();
}

export async function printReceipt(printerIp: string, receipt: PrintReceipt): Promise<void> {
  const printer = createReceiptPrinter(printerIp);
  await renderReceipt(printer, receipt);
  await runPrinterJob(
    printerIp,
    printer,
    `Printed receipt ${receipt.series} ${receipt.aa} (${receipt.id})`,
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
