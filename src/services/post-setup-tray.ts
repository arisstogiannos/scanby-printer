import { pulseTrayIcon } from "@/main/tray-effects";
import { showTrayNotification } from "@/services/tray-notifications";
import { hasSeenTrayDiscovery, markTrayDiscoverySeen } from "@/services/user-preferences";

export function showPostSetupTrayDiscovery(): void {
  if (hasSeenTrayDiscovery()) {
    return;
  }

  markTrayDiscoverySeen();

  showTrayNotification(
    "Scanby is running in the tray",
    "Near the clock. Double-click the tray icon to reopen.",
  );

  pulseTrayIcon();
}
