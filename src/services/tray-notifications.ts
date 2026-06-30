import { Notification } from "electron";
import log from "electron-log";

export function showTrayNotification(title: string, body?: string): void {
  try {
    if (!Notification.isSupported()) {
      log.warn(`Notification not supported: ${title}${body ? ` — ${body}` : ""}`);
      return;
    }

    const notification = new Notification({
      title,
      body,
      silent: false,
    });
    notification.show();
  } catch (error) {
    log.error("Failed to show tray notification", error);
  }
}
