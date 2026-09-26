import { EventEmitter } from "node:events";
import type {
  AppStateSnapshot,
  PrinterRuntimeInfo,
  PrinterScanSnapshot,
  PrinterStatus,
  RegisteredPrinter,
  SetupStage,
} from "@/shared/types";

type AppStateEvents = {
  change: [AppStateSnapshot];
};

class AppState extends EventEmitter<AppStateEvents> {
  private paired = false;
  private businessName: string | null = null;
  private printerIp: string | null = null;
  private printerStatus: PrinterStatus = "offline";
  private setupComplete = false;
  private setupStage: SetupStage = "waiting-pair";
  private pendingPrinterPicker: string[] | null = null;
  private lastScan: PrinterScanSnapshot | null = null;
  private printers: RegisteredPrinter[] = [];
  /** Keyed by printer id; a printer with no entry has never been probed. */
  private printerStatuses = new Map<string, PrinterStatus>();
  private unroutableFiscalCount = 0;

  getSnapshot(): AppStateSnapshot {
    return {
      paired: this.paired,
      businessName: this.businessName,
      printerIp: this.printerIp,
      printerStatus: this.printerStatus,
      printers: this.getPrinterRuntimeInfo(),
      unroutableFiscalCount: this.unroutableFiscalCount,
      setupComplete: this.setupComplete,
      pendingPrinterPicker: this.pendingPrinterPicker,
      lastScan: this.lastScan,
    };
  }

  private getPrinterRuntimeInfo(): PrinterRuntimeInfo[] {
    return this.printers.map((printer) => ({
      ...printer,
      status: this.printerStatuses.get(printer.id) ?? "offline",
    }));
  }

  setPrinters(printers: RegisteredPrinter[]): void {
    this.printers = printers;
    // Drop statuses for printers that no longer exist, so a deleted printer
    // cannot keep an aggregate "online" alive after it is gone.
    const live = new Set(printers.map((printer) => printer.id));
    for (const id of [...this.printerStatuses.keys()]) {
      if (!live.has(id)) {
        this.printerStatuses.delete(id);
      }
    }
    this.emitChange();
  }

  setPrinterStatusById(printerId: string, status: PrinterStatus): void {
    if (this.printerStatuses.get(printerId) === status) {
      return;
    }
    this.printerStatuses.set(printerId, status);
    this.recomputeAggregateStatus();
    this.emitChange();
  }

  /**
   * The single badge the dashboard and the tray still read. "Printing" wins
   * over "online" so activity is visible; "online" wins over "offline" so one
   * unplugged kitchen printer does not report the whole venue as down.
   */
  private recomputeAggregateStatus(): void {
    const statuses = [...this.printerStatuses.values()];
    const aggregate: PrinterStatus = statuses.includes("printing")
      ? "printing"
      : statuses.includes("online")
        ? "online"
        : statuses.includes("scanning")
          ? "scanning"
          : "offline";

    this.printerStatus = aggregate;
  }

  /** A signed document that found no fiscal printer. Only a print clears it. */
  recordUnroutableFiscalDocument(): void {
    this.unroutableFiscalCount += 1;
    this.emitChange();
  }

  clearUnroutableFiscalDocuments(): void {
    if (this.unroutableFiscalCount === 0) {
      return;
    }
    this.unroutableFiscalCount = 0;
    this.emitChange();
  }

  getSetupStage(): SetupStage {
    return this.setupStage;
  }

  setPaired(businessName: string): void {
    this.paired = true;
    this.businessName = businessName;
    this.setupStage = "printer-setup";
    this.emitChange();
  }

  setPrinterIp(ip: string): void {
    this.printerIp = ip;
    this.emitChange();
  }

  setPrinterStatus(status: PrinterStatus): void {
    if (this.printerStatus === status) {
      return;
    }
    this.printerStatus = status;
    this.emitChange();
  }

  setSetupComplete(): void {
    this.setupComplete = true;
    this.setupStage = "complete";
    this.emitChange();
  }

  setPendingPrinterPicker(printers: string[]): void {
    this.pendingPrinterPicker = printers;
    this.emitChange();
  }

  clearPendingPrinterPicker(): void {
    if (!this.pendingPrinterPicker) {
      return;
    }
    this.pendingPrinterPicker = null;
    this.emitChange();
  }

  setLastScan(scan: PrinterScanSnapshot): void {
    this.lastScan = scan;
    this.emitChange();
  }

  reset(): void {
    this.paired = false;
    this.businessName = null;
    this.printerIp = null;
    this.printerStatus = "offline";
    this.setupComplete = false;
    this.setupStage = "waiting-pair";
    this.pendingPrinterPicker = null;
    this.lastScan = null;
    this.printers = [];
    this.printerStatuses.clear();
    this.unroutableFiscalCount = 0;
    this.emitChange();
  }

  private emitChange(): void {
    this.emit("change", this.getSnapshot());
  }
}

export const appState = new AppState();
