import type { Locale } from "@/shared/i18n";

export type { Locale };

export type PrinterStatus = "online" | "offline" | "printing" | "scanning";

export type PrinterRole = "KITCHEN" | "FISCAL" | "ALL";

export type PrinterTransport = "LAN" | "EMBEDDED";

/** What is on the paper, as far as routing is concerned. */
export type PrintDocumentClass = "kitchen_ticket" | "order_slip" | "fiscal_receipt";

/**
 * A printer as the Scanby registry holds it. Cached on disk so routing keeps
 * working through an internet outage — the printers are on the venue's LAN,
 * and losing the office connection is no reason to stop printing tickets.
 */
export type RegisteredPrinter = {
  id: string;
  name: string;
  role: PrinterRole;
  transport: PrinterTransport;
  address: string;
  enabled: boolean;
  /**
   * Kitchen-ticket body size on this printer. Absent from a registry synced
   * before the setting moved onto printers; the order's own size applies then.
   */
  fontSize?: PrintFontSize;
};

export type AppConfig = {
  businessId: string;
  businessName: string;
  supabaseUrl: string;
  supabasePublishableKey: string;
  /**
   * The single printer this app was configured with before roles existed.
   * Still read, still written by the setup flow, and still the thing that gets
   * registered as an `ALL` printer the first time the registry syncs — an
   * upgrade must not stop a venue printing while nobody has assigned roles.
   */
  printerIp: string;
  /** The registry, last time it was pulled. Empty until the first sync. */
  printers?: RegisteredPrinter[];
  /** Mirrors `Business.kitchenTicketsEnabled`; defaults to printing. */
  kitchenTicketsEnabled?: boolean;
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

/** A registry printer plus the reachability only this station can know. */
export type PrinterRuntimeInfo = RegisteredPrinter & {
  status: PrinterStatus;
};

export type AppStateSnapshot = {
  paired: boolean;
  businessName: string | null;
  printerIp: string | null;
  /** The aggregate across every printer: online if any of them is. */
  printerStatus: PrinterStatus;
  printers: PrinterRuntimeInfo[];
  /**
   * A signed document the venue has nowhere to print. Set when the receipt
   * queue gives up finding a fiscal printer; cleared when one prints. Drives
   * the tray warning, so it must never be cleared by anything but a success.
   */
  unroutableFiscalCount: number;
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
  /** The `2x` / `1,5 ΚΙΛ` token as the app formatted it; null prints bare. */
  quantityLabel: string | null;
  /** Already deducted from `totalInCents`; printed so the price is explicable. */
  discountInCents: number;
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
  /**
   * Which printers may render this. Absent on payloads from an app build older
   * than the registry — those are treated as `fiscal_receipt`, the stricter of
   * the two, so an unlabelled document can never land on a kitchen roll.
   */
  documentClass: PrintDocumentClass;
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
  comments: string | null;
  lines: PrintReceiptLine[];
  vatRows: PrintReceiptVatRow[];
  /** Every line's discount summed; already deducted from `totalInCents`. */
  discountInCents: number;
  totalInCents: number;
  /** Empty on an order slip — nothing was collected, so no payment row prints. */
  payMethodLabel: string;
  /** The table, on an order slip. Prints under the document's number and moment. */
  area: string | null;
  /** Prints under the total; an order slip uses it to say the receipt follows. */
  footnote: string | null;
  /**
   * Α.1126/2024 7Α.2: an order slip may not print its total, so this drops the
   * total, payment and receipt-discount rows and the VAT table's gross column.
   */
  hideTotals?: boolean;
  /** Α.1126/2024 7Α.6: an order slip prints its issue moment on its own bold line. */
  emphasizeMoment?: boolean;
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
