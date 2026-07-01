import assert from "node:assert/strict";
import { buildTicketLines } from "../src/services/printer-service";
import { PRINT_DEDUPE_MS } from "../src/shared/constants";
import { initI18n } from "../src/shared/i18n";
import { normalizePairPayload } from "../src/shared/pair-payload";
import { normalizePrintOrder } from "../src/shared/print-payload";
import { normalizePrinterConnectPayload } from "../src/shared/printer-connect-payload";

async function testBuildTicketLines(): Promise<void> {
  await initI18n("el");

  const order = {
    id: "order-1",
    number: 7,
    table: "12",
    createdAt: "2026-06-11T10:30:00.000Z",
    items: [
      { quantity: 2, name: "Salad", price: 800, notes: "No onion" },
      { quantity: 1, name: "Water", price: 250 },
    ],
  };

  const created = buildTicketLines(order, "order_created", "el");
  assert.equal(created.headerLine, "ΝΕΑ ΠΑΡΑΓΓΕΛΙΑ");
  assert.equal(created.tableLine, "ΤΡΑΠΕΖΙ 12  #7");
  assert.equal(created.itemLines.length, 2);
  assert.match(created.itemLines[0].main, /16,00\s*€$/);
  assert.match(created.itemLines[1].main, /2,50\s*€$/);
  assert.equal(created.itemLines[0].note, "No onion");
  assert.equal(created.showItems, true);
  assert.match(created.totalLine ?? "", /18,50\s*€/);
  assert.ok(created.timeLine.length > 0);

  const updated = buildTicketLines(order, "order_updated", "el");
  assert.equal(updated.headerLine, "ΕΝΗΜΕΡΩΣΗ");
  assert.equal(updated.footerLine, "ΕΠΑΝΕΚΤΥΠΩΣΗ");
  assert.equal(updated.showItems, true);

  const cancelled = buildTicketLines(order, "order_cancelled", "el");
  assert.equal(cancelled.headerLine, "ΑΚΥΡΩΣΗ");
  assert.equal(cancelled.footerLine, "Η παραγγελία ακυρώθηκε");
  assert.equal(cancelled.showItems, false);
  assert.equal(cancelled.totalLine, undefined);

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
}

function testConstants(): void {
  assert.equal(PRINT_DEDUPE_MS, 30_000);
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

await testBuildTicketLines();
testDashboardPairPayload();
testDashboardPrintPayload();
testPrinterConnectPayload();
testConstants();
console.log("Core tests passed");
