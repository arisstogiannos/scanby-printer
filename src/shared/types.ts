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

export type OrderPrintEvent = "order_created" | "order_updated" | "order_cancelled";

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
