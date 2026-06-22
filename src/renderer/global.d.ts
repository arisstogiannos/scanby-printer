import type { ScanbyPrintApi } from "@/preload/index";

declare global {
  interface Window {
    scanbyPrint: ScanbyPrintApi;
  }
}
