import { pulseTrayIcon } from "@/main/tray-effects";
import { showTrayNotification } from "@/services/tray-notifications";
import { hasSeenTrayDiscovery, markTrayDiscoverySeen } from "@/services/user-preferences";
import { t } from "@/shared/i18n";

export function showPostSetupTrayDiscovery(): void {
  if (hasSeenTrayDiscovery()) {
    return;
  }

  markTrayDiscoverySeen();

  showTrayNotification(t("notifications.runningInTray"), t("notifications.runningInTrayBody"));

  pulseTrayIcon();
}
