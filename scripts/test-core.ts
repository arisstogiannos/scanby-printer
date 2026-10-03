import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ThermalPrinter } from "node-thermal-printer";
import {
  clearDeliveredLedger,
  deliveredKeys,
  forgetDelivered,
  getReceiptWatermark,
  hasDelivered,
  initDeliveredLedger,
  markDelivered,
  setReceiptWatermark,
} from "../src/services/delivered-ledger";
import { buildTicketLines, renderReceipt } from "../src/services/printer-service";
import {
  AUTO_PRINT_MAX_AGE_MS,
  PRINT_DEDUPE_MS,
  PRINT_RETRY_DELAYS_MS,
  REPRINT_MAX_AGE_MS,
} from "../src/shared/constants";
import { initI18n } from "../src/shared/i18n";
import { normalizePairPayload } from "../src/shared/pair-payload";
import { normalizeOrderPrintEvent, normalizePrintOrder } from "../src/shared/print-payload";
import { normalizePrinterConnectPayload } from "../src/shared/printer-connect-payload";
import { printerAcceptsDocument, selectPrintTargets } from "../src/shared/printer-routing";
import { normalizePrintReceipt } from "../src/shared/receipt-payload";

async function testBuildTicketLines(): Promise<void> {
  await initI18n("el");

  const order = {
    id: "order-1",
    number: 7,
    table: "12",
    createdAt: "2026-06-11T10:30:00.000Z",
    createdByName: "Maria",
    items: [
      { quantity: 2, name: "Salad", price: 800, notes: "No onion" },
      { quantity: 1, name: "Water", price: 250 },
    ],
  };

  const created = buildTicketLines(order, "order_created", "el");
  assert.equal(created.headerLine, "ΝΕΑ ΠΑΡΑΓΓΕΛΙΑ");
  assert.equal(created.tableLine, "ΤΡΑΠΕΖΙ 12  #7");
  assert.equal(created.staffLine, "Staff: Maria");
  assert.equal(created.itemLines.length, 2);
  assert.equal(created.itemLines[0].label, "2x  Salad");
  assert.match(created.itemLines[0].price ?? "", /16,00\s*€/);
  assert.equal(created.itemLines[1].label, "1x  Water");
  assert.match(created.itemLines[1].price ?? "", /2,50\s*€/);
  assert.equal(created.itemLines[0].note, "No onion");
  assert.equal(created.showItems, true);
  assert.match(created.totalLine ?? "", /18,50\s*€/);
  assert.equal(created.totalLabel, "ΣΥΝΟΛΟ");
  assert.equal(created.footerLine, undefined);
  assert.match(created.timeLine, /\d/);
  assert.equal(created.notFiscalLine, "Δεν αποτελεί φορολογική απόδειξη");
  assert.equal(created.poweredByLine, "Powered by Scanby");

  const updated = buildTicketLines(order, "order_updated", "el");
  assert.equal(updated.headerLine, "ΕΝΗΜΕΡΩΣΗ");
  assert.equal(updated.footerLine, "ΕΠΑΝΕΚΤΥΠΩΣΗ");
  assert.equal(updated.showItems, true);

  const cancelled = buildTicketLines(order, "order_cancelled", "el");
  assert.equal(cancelled.headerLine, "ΑΚΥΡΩΣΗ");
  assert.equal(cancelled.footerLine, "Η παραγγελία ακυρώθηκε");
  assert.equal(cancelled.showItems, false);
  assert.equal(cancelled.totalLine, undefined);

  const noStaff = buildTicketLines({ ...order, createdByName: "   " }, "order_created", "el");
  assert.equal(noStaff.staffLine, undefined);

  const noPrices = buildTicketLines(
    {
      id: "order-2",
      number: 1,
      table: "3",
      createdAt: "2026-06-11T10:30:00.000Z",
      items: [{ quantity: 1, name: "Tea" }],
    },
    "order_created",
    "el",
  );
  assert.equal(noPrices.totalLine, undefined);
}

function testDashboardPairPayload(): void {
  const payload = normalizePairPayload({
    venueId: "biz-1",
    venueName: "Test Venue",
    supabaseAnonKey:
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFiY2RlZmdoaWprbG1ub3AiLCJyb2xlIjoiYW5vbiJ9.x",
  });

  assert.ok(payload);
  assert.equal(payload?.businessId, "biz-1");
  assert.equal(payload?.businessName, "Test Venue");
  assert.equal(payload?.supabaseUrl, "https://abcdefghijklmnop.supabase.co");
}

function testDashboardPrintPayload(): void {
  const order = normalizePrintOrder({
    table_number: "5",
    order_number: 12,
    created_at: "2026-06-11T12:00:00.000Z",
    items: [{ quantity: 1, name: "Coffee", unit_price: 350 }],
  });

  assert.ok(order);
  assert.equal(order?.table, "5");
  assert.equal(order?.number, 12);
  assert.equal(order?.items[0]?.price, 350);
  assert.equal(order?.fontSize, undefined);

  const baseOrder = {
    id: "order-3",
    number: 4,
    table: "9",
    createdAt: "2026-06-11T12:00:00.000Z",
    items: [{ quantity: 1, name: "Tea" }],
  };

  assert.equal(normalizePrintOrder({ order: { ...baseOrder, fontSize: "big" } })?.fontSize, "big");
  assert.equal(
    normalizePrintOrder({ order: { ...baseOrder, fontSize: "default" } })?.fontSize,
    "default",
  );
  assert.equal(
    normalizePrintOrder({ order: { ...baseOrder, fontSize: "huge" } })?.fontSize,
    undefined,
  );
  assert.equal(normalizePrintOrder({ order: baseOrder })?.fontSize, undefined);
}

/** Α.1126/2024 7Α.3: the disclaimer every 8.6 must carry. */
const ORDER_SLIP_FOOTNOTE =
  "ΤΟ ΠΑΡΟΝ ΕΙΝΑΙ ΠΛΗΡΟΦΟΡΙΑΚΟ ΣΤΟΙΧΕΙΟ ΚΑΙ ΔΕΝ ΑΠΟΤΕΛΕΙ ΝΟΜΙΜΗ ΦΟΡΟΛΟΓΙΚΗ ΑΠΟΔΕΙΞΗ/ΤΙΜΟΛΟΓΙΟ.";

/** An 8.6 Δελτίο Παραγγελίας as the app puts it on the wire. */
const ORDER_SLIP_PAYLOAD = {
  id: "receipt-1",
  businessName: "Kafeneio",
  legalName: "KAFENEIO AE",
  vatId: "123456789",
  address: "Ermou 1",
  title: "ΔΕΛΤΙΟ ΠΑΡΑΓΓΕΛΙΑΣ",
  series: "A",
  aa: 42,
  momentIso: "2026-06-11T10:30:00.000Z",
  cashierName: "Maria",
  customer: null,
  lines: [{ name: "Freddo", quantity: 2, quantityLabel: "2x", totalInCents: 700, rateBps: 1300 }],
  comments: null,
  discountInCents: 0,
  vatRows: [{ rateBps: 1300, netInCents: 619, vatInCents: 81, grossInCents: 700 }],
  totalInCents: 700,
  payMethodLabel: "",
  area: "12",
  footnote: ORDER_SLIP_FOOTNOTE,
  hideTotals: true,
  emphasizeMoment: true,
  transmissionFailure: null,
  signatures: [{ caption: "invoiceMark", data: "400001", format: 1 }],
  qrUrl: "https://scanby.cloud/r/abc",
};

/** The same sale as a receipt: it collects, so it prints its total and payment row. */
const FISCAL_RECEIPT_PAYLOAD = {
  ...ORDER_SLIP_PAYLOAD,
  payMethodLabel: "ΜΕΤΡΗΤΑ",
  area: null,
  footnote: null,
  hideTotals: false,
  emphasizeMoment: false,
};

function testOrderSlipReceiptPayload(): void {
  const slip = normalizePrintReceipt({ receipt: ORDER_SLIP_PAYLOAD });
  assert.ok(slip);
  // The table and the footnote are the whole reason a slip differs from a
  // receipt; dropping either silently is what this test exists to catch.
  assert.equal(slip?.area, "12");
  assert.equal(slip?.footnote, ORDER_SLIP_FOOTNOTE);
  // Empty, so the renderer prints no payment row at all.
  assert.equal(slip?.payMethodLabel, "");
  // Dropping either would print a total or bury the moment: both are 7Α breaches.
  assert.equal(slip?.hideTotals, true);
  assert.equal(slip?.emphasizeMoment, true);

  // A receipt omits both, and an older app build sends neither.
  const receipt = normalizePrintReceipt({ receipt: FISCAL_RECEIPT_PAYLOAD });
  assert.equal(receipt?.area, null);
  assert.equal(receipt?.footnote, null);
  assert.equal(receipt?.payMethodLabel, "ΜΕΤΡΗΤΑ");
  assert.equal(receipt?.hideTotals, false);
  assert.equal(receipt?.emphasizeMoment, false);

  const legacy = normalizePrintReceipt({
    receipt: {
      ...ORDER_SLIP_PAYLOAD,
      area: undefined,
      footnote: undefined,
      hideTotals: undefined,
      emphasizeMoment: undefined,
    },
  });
  assert.ok(legacy);
  assert.equal(legacy?.area, null);
  assert.equal(legacy?.footnote, null);
  // No flags means today's full layout, so an older app build is unaffected.
  assert.equal(legacy?.hideTotals, false);
  assert.equal(legacy?.emphasizeMoment, false);

  // Only a real `true` counts; a stringly-typed flag must not hide a total.
  const junk = normalizePrintReceipt({
    receipt: { ...ORDER_SLIP_PAYLOAD, hideTotals: "true", emphasizeMoment: 1 },
  });
  assert.equal(junk?.hideTotals, false);
  assert.equal(junk?.emphasizeMoment, false);
}

type RenderCall = { method: string; args: unknown[] };

/**
 * Stands in for a ThermalPrinter and records what the layout asked it to do.
 * `getText()` on a real one returns PC737-encoded bytes, so the Greek is
 * unreadable there — the call log is what can actually be asserted on.
 */
function recordingPrinter(): { calls: RenderCall[]; printer: ThermalPrinter } {
  const calls: RenderCall[] = [];
  const printer = new Proxy(
    {},
    {
      get:
        (_target, method: string) =>
        (...args: unknown[]) => {
          calls.push({ method, args });
        },
    },
  ) as ThermalPrinter;
  return { calls, printer };
}

function printedLines(calls: RenderCall[]): string[] {
  return calls.filter((call) => call.method === "println").map((call) => String(call.args[0]));
}

/** Every piece of text that reaches paper, from both `println` and `leftRight`. */
function printedText(calls: RenderCall[]): string[] {
  return calls
    .filter((call) => call.method === "println" || call.method === "leftRight")
    .flatMap((call) => call.args.map(String));
}

async function testOrderSlipLayout(): Promise<void> {
  const slip = normalizePrintReceipt({ receipt: ORDER_SLIP_PAYLOAD });
  assert.ok(slip);

  const { calls, printer } = recordingPrinter();
  await renderReceipt(printer, slip);
  const lines = printedLines(calls);

  assert.ok(lines.includes("ΤΡΑΠΕΖΙ: 12"), "slip must print its table");
  assert.ok(lines.includes(ORDER_SLIP_FOOTNOTE), "slip must carry the 7Α.3 disclaimer");
  // The old layout printed a bare amount against an empty label here.
  const payRows = calls.filter((call) => call.method === "leftRight" && call.args[0] === "");
  assert.equal(payRows.length, 0, "a slip collects nothing, so it prints no payment row");

  // 7Α.2: no total anywhere — not the bold row, not the VAT table's gross column.
  assert.ok(
    !printedText(calls).some((text) => text.includes("ΣΥΝΟΛΟ")),
    "a slip may not print its total",
  );
  // 7Α.1 still wants net and VAT per rate.
  assert.ok(lines.includes("ΦΠΑ%     ΚΑΘΑΡΗ      ΦΠΑ"));
  assert.ok(lines.includes("13%       6.19€   0.81€"));

  // 7Α.6: the number on its own line, then the moment alone and in bold.
  assert.equal(leftRightRow(calls, "A 42"), undefined);
  const numberAt = calls.findIndex((call) => call.method === "println" && call.args[0] === "A 42");
  assert.ok(numberAt >= 0, "slip must print its series and number");
  assert.deepEqual(
    calls.slice(numberAt + 1, numberAt + 4).map((call) => [call.method, typeof call.args[0]]),
    [
      ["bold", "boolean"],
      ["println", "string"],
      ["bold", "boolean"],
    ],
  );
  assert.equal(calls[numberAt + 1]?.args[0], true);
  assert.match(String(calls[numberAt + 2]?.args[0]), /\d{1,2}\/\d{1,2}\/\d{2,4}/);
  assert.equal(calls[numberAt + 3]?.args[0], false);

  const receiptOnly = normalizePrintReceipt({ receipt: FISCAL_RECEIPT_PAYLOAD });
  assert.ok(receiptOnly);
  const plain = recordingPrinter();
  await renderReceipt(plain.printer, receiptOnly);
  const plainLines = printedLines(plain.calls);

  assert.ok(!plainLines.some((line) => line.startsWith("ΤΡΑΠΕΖΙ")));
  assert.ok(!plainLines.includes(ORDER_SLIP_FOOTNOTE));
  assert.ok(
    plain.calls.some((call) => call.method === "leftRight" && call.args[0] === "ΜΕΤΡΗΤΑ"),
    "a receipt still prints its payment row",
  );
  assert.equal(leftRightRow(plain.calls, "ΣΥΝΟΛΟ"), "7.00€", "a receipt still prints its total");
  assert.ok(plainLines.includes("ΦΠΑ%     ΚΑΘΑΡΗ      ΦΠΑ     ΣΥΝΟΛΟ"));
  assert.ok(plainLines.includes("13%       6.19€   0.81€    7.00€"));
  // Without the flag the moment stays on the number's row.
  assert.match(leftRightRow(plain.calls, "A 42") ?? "", /\d{1,2}\/\d{1,2}\/\d{2,4}/);
  assert.ok(!plainLines.includes("A 42"));
}

/** A weighed line, discounted, with a note — none of which used to print. */
const WEIGHED_RECEIPT_PAYLOAD = {
  ...FISCAL_RECEIPT_PAYLOAD,
  title: "ΑΠΟΔΕΙΞΗ ΛΙΑΝΙΚΗΣ ΠΩΛΗΣΗΣ",
  comments: "Χωρίς σακούλα",
  lines: [
    {
      name: "Κιμάς",
      quantity: 2.5,
      quantityLabel: "2,5 ΚΙΛ",
      totalInCents: 1800,
      discountInCents: 200,
      rateBps: 1300,
    },
  ],
  discountInCents: 200,
  totalInCents: 1800,
};

function leftRightRow(calls: RenderCall[], left: string): string | undefined {
  const call = calls.find((entry) => entry.method === "leftRight" && entry.args[0] === left);
  return call === undefined ? undefined : String(call.args[1]);
}

async function testWeighedDiscountedLayout(): Promise<void> {
  const receipt = normalizePrintReceipt({ receipt: WEIGHED_RECEIPT_PAYLOAD });
  assert.ok(receipt);
  assert.equal(receipt?.lines[0]?.quantityLabel, "2,5 ΚΙΛ");
  assert.equal(receipt?.lines[0]?.discountInCents, 200);

  const { calls, printer } = recordingPrinter();
  await renderReceipt(printer, receipt);

  // AADE is told 2,5 ΚΙΛ, so the paper may not say "2x" or drop the amount.
  const item = calls.find(
    (call) => call.method === "leftRight" && String(call.args[0]).includes("Κιμάς"),
  );
  assert.equal(item?.args[0], "2,5 ΚΙΛ Κιμάς (13%)");

  assert.equal(leftRightRow(calls, "  ΕΚΠΤΩΣΗ"), "20.00€ - 2.00€");
  assert.equal(leftRightRow(calls, "ΣΥΝΟΛΙΚΗ ΕΚΠΤΩΣΗ"), "-2.00€");

  const lines = printedLines(calls);
  assert.ok(lines.includes("ΠΑΡΑΤΗΡΗΣΕΙΣ"));
  assert.ok(lines.includes("Χωρίς σακούλα"));

  // On a slip the receipt-level discount is a total too, so it goes; the
  // per-line row stays, because it explains a price that does print.
  const slip = normalizePrintReceipt({
    receipt: { ...WEIGHED_RECEIPT_PAYLOAD, hideTotals: true },
  });
  assert.ok(slip);
  const slipRender = recordingPrinter();
  await renderReceipt(slipRender.printer, slip);
  assert.equal(leftRightRow(slipRender.calls, "  ΕΚΠΤΩΣΗ"), "20.00€ - 2.00€");
  assert.equal(leftRightRow(slipRender.calls, "ΣΥΝΟΛΙΚΗ ΕΚΠΤΩΣΗ"), undefined);
}

/** A build that predates `quantityLabel` still prints its piece count. */
async function testLegacyQuantityFallback(): Promise<void> {
  const receipt = normalizePrintReceipt({
    receipt: {
      ...ORDER_SLIP_PAYLOAD,
      lines: [{ name: "Freddo", quantity: 2, totalInCents: 700, rateBps: 1300 }],
    },
  });
  assert.ok(receipt);
  assert.equal(receipt?.lines[0]?.quantityLabel, null);
  assert.equal(receipt?.lines[0]?.discountInCents, 0);

  const { calls, printer } = recordingPrinter();
  await renderReceipt(printer, receipt);
  const item = calls.find(
    (call) => call.method === "leftRight" && String(call.args[0]).includes("Freddo"),
  );
  assert.equal(item?.args[0], "2x Freddo (13%)");
  assert.equal(leftRightRow(calls, "  ΕΚΠΤΩΣΗ"), undefined);
  assert.equal(leftRightRow(calls, "ΣΥΝΟΛΙΚΗ ΕΚΠΤΩΣΗ"), undefined);
}

function testConstants(): void {
  assert.equal(PRINT_DEDUPE_MS, 30_000);
}

function testOrderPrintEventPayload(): void {
  assert.equal(normalizeOrderPrintEvent("order_created"), "order_created");
  assert.equal(normalizeOrderPrintEvent("order_reprint"), "order_reprint");
  assert.equal(normalizeOrderPrintEvent("order_cancelled"), "order_cancelled");

  // An older dashboard sends nothing, and junk must not decide a ticket header.
  assert.equal(normalizeOrderPrintEvent(undefined), null);
  assert.equal(normalizeOrderPrintEvent("new_order"), null);
  assert.equal(normalizeOrderPrintEvent(7), null);
}

function testPrinterConnectPayload(): void {
  const payload = normalizePrinterConnectPayload({ ip: "192.168.1.50" });
  assert.ok(payload);
  assert.equal(payload?.ip, "192.168.1.50");

  const alias = normalizePrinterConnectPayload({ printerIp: " 10.0.0.2 " });
  assert.ok(alias);
  assert.equal(alias?.ip, "10.0.0.2");

  assert.equal(normalizePrinterConnectPayload({}), null);
  assert.equal(normalizePrinterConnectPayload({ ip: "not-an-ip" }), null);
  assert.equal(normalizePrinterConnectPayload({ ip: "256.1.1.1" }), null);
}

function testPrinterRouting(): void {
  // The invariant the whole feature exists for: a legal document may never
  // reach a kitchen-only printer, and a kitchen ticket may never reach a
  // fiscal-only one. Mirrored in the web app and the Android shell.
  assert.equal(printerAcceptsDocument("KITCHEN", "fiscal_receipt"), false);
  assert.equal(printerAcceptsDocument("KITCHEN", "order_slip"), false);
  assert.equal(printerAcceptsDocument("FISCAL", "kitchen_ticket"), false);
  assert.equal(printerAcceptsDocument("ALL", "kitchen_ticket"), true);
  assert.equal(printerAcceptsDocument("ALL", "fiscal_receipt"), true);

  const bar = {
    id: "bar",
    name: "Bar",
    role: "KITCHEN" as const,
    transport: "LAN" as const,
    address: "10.0.0.2",
    enabled: true,
  };
  const grill = { ...bar, id: "grill", name: "Grill", address: "10.0.0.3" };
  const till = {
    ...bar,
    id: "till",
    name: "Till",
    role: "FISCAL" as const,
    address: "10.0.0.4",
  };
  const spare = { ...bar, id: "spare", name: "Spare", enabled: false, address: "10.0.0.5" };

  // Fan-out: both kitchen printers, never the till.
  const kitchenTargets = selectPrintTargets([bar, grill, till, spare], "kitchen_ticket");
  assert.deepEqual(
    kitchenTargets.map((printer) => printer.id),
    ["bar", "grill"],
  );

  // A receipt goes only to the till, and an order slip follows the receipt.
  for (const documentClass of ["fiscal_receipt", "order_slip"] as const) {
    const targets = selectPrintTargets([bar, grill, till], documentClass);
    assert.deepEqual(
      targets.map((printer) => printer.id),
      ["till"],
    );
  }

  // No fiscal printer registered means no targets — the receipt queue turns
  // that into a held job and an alert, never a print on the kitchen roll.
  assert.deepEqual(selectPrintTargets([bar, grill], "fiscal_receipt"), []);
}

function testDeliveredLedger(): void {
  const dir = mkdtempSync(join(tmpdir(), "scanby-ledger-"));
  try {
    initDeliveredLedger(dir);
    const ticket = deliveredKeys.orderCreated("order-1");
    assert.equal(hasDelivered(ticket), false);

    markDelivered(ticket);
    assert.equal(hasDelivered(ticket), true);

    // Survives a restart: a ticket taken before the app closed prints once.
    initDeliveredLedger(dir);
    assert.equal(hasDelivered(ticket), true);

    forgetDelivered(ticket);
    assert.equal(hasDelivered(ticket), false);

    setReceiptWatermark("2026-09-26T12:00:00.000Z");
    assert.equal(getReceiptWatermark(60_000), "2026-09-26T12:00:00.000Z");
    // Too long since it was saved: the app was not running, so start fresh.
    assert.equal(getReceiptWatermark(-1), null);

    markDelivered(deliveredKeys.relayJob("job-1"));
    clearDeliveredLedger();
    assert.equal(hasDelivered(deliveredKeys.relayJob("job-1")), false);
    assert.equal(getReceiptWatermark(60_000), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function testRetryWindows(): void {
  // Retried until too old, never after a count: the delays only pace it.
  assert.equal(PRINT_RETRY_DELAYS_MS.at(-1), 30_000);
  assert.equal(AUTO_PRINT_MAX_AGE_MS, 60 * 60 * 1000);
  assert.equal(REPRINT_MAX_AGE_MS, 10 * 60 * 1000);
}

function testReceiptDocumentClass(): void {
  const slip = normalizePrintReceipt({
    receipt: {
      id: "r1",
      documentClass: "order_slip",
      businessName: "Cafe",
      legalName: "Cafe AE",
      vatId: "123456789",
      title: "ΔΕΛΤΙΟ ΠΑΡΑΓΓΕΛΙΑΣ",
      series: "A",
      aa: 1,
      momentIso: "2026-06-11T10:30:00.000Z",
      payMethodLabel: "",
      totalInCents: 1000,
      lines: [],
      vatRows: [],
      signatures: [],
    },
  });
  assert.equal(slip?.documentClass, "order_slip");

  // An older app build sends no class at all. It must be treated as the
  // stricter one, so an unlabelled document never routes to a kitchen roll.
  const legacy = normalizePrintReceipt({
    receipt: {
      id: "r2",
      businessName: "Cafe",
      legalName: "Cafe AE",
      vatId: "123456789",
      title: "ΑΠΟΔΕΙΞΗ ΛΙΑΝΙΚΗΣ ΠΩΛΗΣΗΣ",
      series: "A",
      aa: 2,
      momentIso: "2026-06-11T10:30:00.000Z",
      payMethodLabel: "ΜΕΤΡΗΤΑ",
      totalInCents: 1000,
      lines: [],
      vatRows: [],
      signatures: [],
    },
  });
  assert.equal(legacy?.documentClass, "fiscal_receipt");
}

await testBuildTicketLines();
testDashboardPairPayload();
testDashboardPrintPayload();
testPrinterConnectPayload();
testOrderPrintEventPayload();
testOrderSlipReceiptPayload();
await testOrderSlipLayout();
await testWeighedDiscountedLayout();
await testLegacyQuantityFallback();
testConstants();
testPrinterRouting();
testReceiptDocumentClass();
testDeliveredLedger();
testRetryWindows();
console.log("Core tests passed");
