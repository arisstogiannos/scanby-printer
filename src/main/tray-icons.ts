import { getTrayIcon } from "@/main/app-icon";

export function iconForPrinterStatus(
  _status: "online" | "offline" | "printing" | "scanning",
): Electron.NativeImage {
  return getTrayIcon();
}
