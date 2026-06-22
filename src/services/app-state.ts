import { EventEmitter } from "node:events";
import type { AppStateSnapshot, PrinterStatus, SetupStage } from "@/shared/types";

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

  getSnapshot(): AppStateSnapshot {
    return {
      paired: this.paired,
      businessName: this.businessName,
      printerIp: this.printerIp,
      printerStatus: this.printerStatus,
      setupComplete: this.setupComplete,
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
    this.printerStatus = status;
    this.emitChange();
  }

  setSetupComplete(): void {
    this.setupComplete = true;
    this.setupStage = "complete";
    this.emitChange();
  }

  reset(): void {
    this.paired = false;
    this.businessName = null;
    this.printerIp = null;
    this.printerStatus = "offline";
    this.setupComplete = false;
    this.setupStage = "waiting-pair";
    this.emitChange();
  }

  private emitChange(): void {
    this.emit("change", this.getSnapshot());
  }
}

export const appState = new AppState();
