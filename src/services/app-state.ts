import { EventEmitter } from "node:events";
import type {
  AppStateSnapshot,
  PrinterScanSnapshot,
  PrinterStatus,
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

  getSnapshot(): AppStateSnapshot {
    return {
      paired: this.paired,
      businessName: this.businessName,
      printerIp: this.printerIp,
      printerStatus: this.printerStatus,
      setupComplete: this.setupComplete,
      pendingPrinterPicker: this.pendingPrinterPicker,
      lastScan: this.lastScan,
    };
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
    this.emitChange();
  }

  private emitChange(): void {
    this.emit("change", this.getSnapshot());
  }
}

export const appState = new AppState();
