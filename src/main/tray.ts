import { Menu, Tray } from "electron";
import log from "electron-log";
import { iconForPrinterStatus } from "@/main/tray-icons";
import { showSetupWindow } from "@/main/window-manager";
import { appState } from "@/services/app-state";
import { getConfig, isConfigured, isPaired } from "@/services/config-store";
import { testPrint } from "@/services/printer-service";
import { unpairApp } from "@/services/unpair";
import { t } from "@/shared/i18n";
import type { PrinterStatus } from "@/shared/types";

let tray: Tray | null = null;
let quitHandler: (() => void) | null = null;
let contextMenu: Menu | null = null;

function printerStatusLabel(status: PrinterStatus): string {
  switch (status) {
    case "online":
      return t("tray.printerOnline");
    case "printing":
      return t("tray.printerPrinting");
    case "scanning":
      return t("tray.printerScanning");
    default:
      return t("tray.printerOffline");
  }
}

function statusTooltipLabel(status: PrinterStatus): string {
  const labels: Record<PrinterStatus, string> = {
    online: t("status.online"),
    offline: t("status.offline"),
    printing: t("status.printing"),
    scanning: t("status.scanning"),
  };
  return labels[status];
}

function buildMenu(): Menu {
  const snapshot = appState.getSnapshot();
  const config = getConfig();

  const printerLabel = printerStatusLabel(snapshot.printerStatus);

  const venueLabel = snapshot.businessName
    ? t("tray.venue", { name: snapshot.businessName })
    : t("tray.venueNotPaired");

  const items: Electron.MenuItemConstructorOptions[] = [
    { label: t("tray.appName"), enabled: false },
    { type: "separator" },
    { label: printerLabel, enabled: false },
    { label: venueLabel, enabled: false },
    { type: "separator" },
    {
      label: t("tray.settings"),
      click: () => {
        showSetupWindow();
      },
    },
    {
      label: t("tray.testPrint"),
      enabled: Boolean(config?.printerIp),
      click: () => {
        if (!config?.printerIp) {
          return;
        }
        void testPrint(config.printerIp).catch((error) => {
          log.error("Tray test print failed", error);
        });
      },
    },
    ...(isPaired()
      ? [
          {
            label: t("tray.disconnectVenue"),
            click: () => {
              void unpairApp().then(() => showSetupWindow());
            },
          } satisfies Electron.MenuItemConstructorOptions,
        ]
      : []),
    { type: "separator" },
  ];

  if (quitHandler) {
    items.push({
      label: t("tray.quit"),
      click: quitHandler,
    });
  }

  return Menu.buildFromTemplate(items);
}

function updateTrayIcon(): void {
  if (!tray) {
    return;
  }
  const snapshot = appState.getSnapshot();
  tray.setImage(iconForPrinterStatus(snapshot.printerStatus));
  tray.setToolTip(t("tray.tooltip", { status: statusTooltipLabel(snapshot.printerStatus) }));
  contextMenu = buildMenu();
}

export function initTray(quitItem: { label: string; click: () => void }): Tray {
  quitHandler = quitItem.click;

  if (tray) {
    return tray;
  }

  tray = new Tray(iconForPrinterStatus("offline"));
  tray.setToolTip(t("tray.appName"));
  contextMenu = buildMenu();

  appState.on("change", () => {
    updateTrayIcon();
  });

  if (isConfigured()) {
    updateTrayIcon();
  }

  tray.on("click", () => {
    showSetupWindow();
  });

  tray.on("double-click", () => {
    showSetupWindow();
  });

  tray.on("right-click", () => {
    tray?.popUpContextMenu(contextMenu ?? buildMenu());
  });

  return tray;
}

export function destroyTray(): void {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

export function refreshTray(): void {
  updateTrayIcon();
}

export function getTrayInstance(): Tray | null {
  return tray;
}
