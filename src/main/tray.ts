import { Menu, Tray } from "electron";
import log from "electron-log";
import { iconForPrinterStatus } from "@/main/tray-icons";
import { showSetupWindow } from "@/main/window-manager";
import { appState } from "@/services/app-state";
import { getConfig, isConfigured, isPaired } from "@/services/config-store";
import { testPrint } from "@/services/printer-service";
import { unpairApp } from "@/services/unpair";

let tray: Tray | null = null;
let quitHandler: (() => void) | null = null;
let contextMenu: Menu | null = null;

function buildMenu(): Menu {
  const snapshot = appState.getSnapshot();
  const config = getConfig();

  const printerLabel =
    snapshot.printerStatus === "online"
      ? "Printer: Online"
      : snapshot.printerStatus === "printing"
        ? "Printer: Printing..."
        : snapshot.printerStatus === "scanning"
          ? "Printer: Scanning..."
          : "Printer: Offline";

  const venueLabel = snapshot.businessName
    ? `Venue: ${snapshot.businessName}`
    : "Venue: Not paired";

  const items: Electron.MenuItemConstructorOptions[] = [
    { label: "Scanby Print Service", enabled: false },
    { type: "separator" },
    { label: printerLabel, enabled: false },
    { label: venueLabel, enabled: false },
    { type: "separator" },
    {
      label: "Settings",
      click: () => {
        showSetupWindow();
      },
    },
    {
      label: "Test Print",
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
            label: "Disconnect venue",
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
      label: "Quit",
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
  tray.setToolTip(`Scanby Print Service — ${snapshot.printerStatus}`);
  contextMenu = buildMenu();
}

export function initTray(quitItem: { label: string; click: () => void }): Tray {
  quitHandler = quitItem.click;

  if (tray) {
    return tray;
  }

  tray = new Tray(iconForPrinterStatus("offline"));
  tray.setToolTip("Scanby Print Service");
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
