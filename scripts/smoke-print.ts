import { printOrder } from "../src/services/printer-service";
import type { PrintOrder } from "../src/shared/types";

const sampleOrder: PrintOrder = {
  id: "smoke-test",
  number: 42,
  table: "5",
  createdAt: new Date().toISOString(),
  items: [
    { quantity: 2, name: "Greek Salad", price: 950, notes: "No onion" },
    { quantity: 1, name: "Moussaka", price: 1200 },
  ],
};

const printerIp = process.argv[2];

if (!printerIp) {
  console.error("Usage: pnpm smoke-print <printer-ip>");
  process.exit(1);
}

printOrder(printerIp, sampleOrder)
  .then(() => {
    console.log(`Smoke print sent to ${printerIp}`);
  })
  .catch((error) => {
    console.error("Smoke print failed:", error);
    process.exit(1);
  });
