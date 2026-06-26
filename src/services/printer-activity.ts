import { POST_PRINT_GRACE_MS } from "@/shared/constants";
import type { PrinterStatus } from "@/shared/types";

let printOperationInFlight = false;
let activityGeneration = 0;
let graceUntil = 0;

export function beginPrintOperation(): void {
  printOperationInFlight = true;
  activityGeneration += 1;
}

export function endPrintOperation(): void {
  printOperationInFlight = false;
  graceUntil = Date.now() + POST_PRINT_GRACE_MS;
  activityGeneration += 1;
}

export function isPrintOperationInFlight(): boolean {
  return printOperationInFlight;
}

export function isInPostPrintGrace(): boolean {
  return Date.now() < graceUntil;
}

export function shouldBlockProbeStatusUpdate(printerStatus: PrinterStatus): boolean {
  return printOperationInFlight || printerStatus === "printing" || isInPostPrintGrace();
}

export function captureActivityGeneration(): number {
  return activityGeneration;
}

export function activityChangedSince(generation: number): boolean {
  return generation !== activityGeneration;
}

export function statusLooksOnline(printerStatus: PrinterStatus): boolean {
  return printerStatus === "online" || printerStatus === "printing";
}
