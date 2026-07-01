import { pulseTrayIcon } from "@/main/tray-effects";
import { showSetupWindow } from "@/main/window-manager";
import { showTrayNotification } from "@/services/tray-notifications";
import { t } from "@/shared/i18n";

export function surfaceWindowForUpdateReady(version: string): void {
  showSetupWindow();
  showTrayNotification(
    t("notifications.updateReady"),
    t("notifications.updateReadyBody", { version }),
  );
  pulseTrayIcon();
}
