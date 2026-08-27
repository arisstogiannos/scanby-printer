import type { Locale } from "@/shared/i18n";

export type { Locale };

export type PrinterStatus = "online" | "offline" | "printing" | "scanning";

export type AppConfig = {
  businessId: string;
  businessName: string;
  supabaseUrl: string;
  supabasePublishableKey: string;
  printerIp: string;
};

export type PairPayload = {
  businessId: string;
  businessName: string;
  supabaseUrl: string;
  supabasePublishableKey: string;
};

export type PrintFontSize = "default" | "big";

export type PrintOrderItem = {
  quantity: number;
  name: string;
  price?: number; // unit price in cents
  notes?: string;
};

export type PrintOrder = {
  id: string;
  number: number;
  table: string;
  items: PrintOrderItem[];
  createdAt: string;
  createdByName?: string | null;
  fontSize?: PrintFontSize;
};

export type StatusResponse = {
  connected: boolean;
  printer: PrinterStatus;
  businessName: string | null;
  paired: boolean;
};

export type PrinterScanSnapshot = {
  printers: string[];
  subnet: string | null;
  completedAt: string;
};

export type AppStateSnapshot = {
  paired: boolean;
  businessName: string | null;
  printerIp: string | null;
  printerStatus: PrinterStatus;
  setupComplete: boolean;
  pendingPrinterPicker: string[] | null;
  lastScan: PrinterScanSnapshot | null;
};

export type SetupStage = "waiting-pair" | "printer-setup" | "complete";

export type OrderPrintEvent =
  | "order_created"
  | "order_updated"
  | "order_cancelled"
  | "order_reprint";

export type ReceiptPrintEvent = "receipt_created" | "receipt_reprint";

export type PrintReceiptLine = {
  name: string;
  quantity: number;
  totalInCents: number;
  rateBps: number;
};

export type PrintReceiptVatRow = {
  rateBps: number;
  netInCents: number;
  vatInCents: number;
  grossInCents: number;
};

export type PrintReceiptSignature = {
  caption: string;
  data: string;
  format: number;
};

export type PrintReceipt = {
  id: string;
  businessName: string;
  legalName: string;
  vatId: string;
  address: string | null;
  title: string;
  series: string;
  aa: number;
  momentIso: string;
  cashierName: string | null;
  customer: { name: string; vatId: string; street?: string; zip?: string; city?: string } | null;
  lines: PrintReceiptLine[];
  vatRows: PrintReceiptVatRow[];
  totalInCents: number;
  payMethodLabel: string;
  transmissionFailure: 1 | 2 | null;
  signatures: PrintReceiptSignature[];
  qrUrl: string | null;
};

export type PrintHistorySource = "realtime" | "manual" | "test";

export type PrintHistoryStatus = "received" | "printed" | "failed";

export type PrintHistoryEntry = {
  id: string;
  businessId: string;
  orderId: string;
  orderNumber: number;
  table: string;
  printedAt: string;
  source: PrintHistorySource;
  status: PrintHistoryStatus;
  payload?: PrintOrder;
  error?: string;
};

export type UpdateStatus = "idle" | "checking" | "available" | "downloading" | "ready" | "error";

export type UpdateState = {
  status: UpdateStatus;
  version: string | null;
  lastCheckedAt: string | null;
  isStoreBuild: boolean;
  error: string | null;
};

export type RendererAppState = AppStateSnapshot & {
  version: string;
  locale: Locale;
  setupStage: SetupStage;
  paired: boolean;
  configured: boolean;
  configSummary: {
    businessId: string | null;
    businessName: string | null;
    printerIp: string | null;
    hasPublishableKey: boolean;
  };
  printHistory: PrintHistoryEntry[];
  update: UpdateState;
  showTrayDiscovery: boolean;
};
